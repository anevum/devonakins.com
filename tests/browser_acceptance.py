#!/usr/bin/env python3
"""Offline Chromium/WebKit acceptance for the compiled personal-site preview.

Uses only built dist files. Blocks network requests, and does not use account
information, cookies, metrics, credentials or production endpoints.
"""
import argparse
import base64
from datetime import datetime, timezone, timedelta
import json
import os
import re
import subprocess
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

VIEWPORTS = [(320, 568), (390, 700), (390, 844), (768, 900), (844, 320), (1024, 768), (1440, 900)]


def compiled_preview(dist: Path):
    html = (dist / "v2/index.html").read_text(encoding="utf-8")
    css = (dist / "v2/terminal.css").read_text(encoding="utf-8")
    scripts = re.findall(r'<script type="module"[^>]+src="(/assets/[^"]+\.js)"[^>]*></script>', html)
    client = [path for path in scripts if path.rsplit("/", 1)[-1].startswith("terminal-")]
    if len(client) != 1:
        raise AssertionError(f"Expected one terminal entrypoint, got {scripts}")
    script = (dist / client[0].lstrip("/")).read_text(encoding="utf-8")
    # The generated modulepreload polyfill is unrelated to these controls.
    script, count = re.subn(r'^import"\./modulepreload-polyfill-[^"]+";', "", script)
    if count > 1:
        raise AssertionError("Unexpected compiled Vite entrypoint imports")
    html = re.sub(r'<script type="module"[^>]*></script>', "", html)
    html = re.sub(r'<link\b[^>]*>', "", html)
    for resource, media in [
        ("brand-mark-mono.svg", "image/svg+xml"),
        ("v2/crossed-arms.webp", "image/webp"),
    ]:
        blob = (dist / resource).read_bytes()
        url = f"data:{media};base64," + base64.b64encode(blob).decode("ascii")
        if f'"/{resource}"' not in html:
            raise AssertionError(f"Required asset missing from preview: {resource}")
        html = html.replace(f'"/{resource}"', f'"{url}"')
    return html, css, script


class QuietStaticHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def start_static_origin(dist: Path):
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0),
        partial(QuietStaticHandler, directory=str(dist.resolve())),
    )
    Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_port}"


def check(browser, engine, html, css, script, axe_source, output, origin):

    results = []
    for width, height in VIEWPORTS:
        context = browser.new_context(
            viewport={"width": width, "height": height}, reduced_motion="reduce"
        )
        page = context.new_page()
        page.set_default_timeout(7000)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route(
            "**/*",
            (lambda route: route.continue_() if route.request.url.startswith(
                origin + "/"
            ) else route.abort()) if origin else (lambda route: route.abort()),
        )
        label = f"{engine}-{width}x{height}"
        try:
            if origin:
                response = page.goto(origin + "/v2/", wait_until="load")
                assert response and response.status == 200, "local preview did not load"
            else:
                # Local fallback for sandboxed browsers that prohibit all localhost
                # navigation. CI uses a real HTTP origin for WebKit history fidelity.
                page.set_content(html, wait_until="domcontentloaded")
                page.add_style_tag(content=css)
                page.add_script_tag(content=script)
            page.locator("#panel-home").wait_for(state="visible")
            assert page.locator("#home-usage-value").count() == 0, "redundant homepage statistic remains"
            assert page.locator(".telemetry-profile-link").get_attribute("href") == "/gpt/"
            if origin:
                page.wait_for_function("""() => {
                    const value = document.querySelector('#usage-value');
                    const status = document.querySelector('#usage-status');
                    return value?.textContent?.trim() === '≈2.7B' &&
                        status?.textContent?.includes('25D STREAK') &&
                        status?.textContent?.includes('314.2M PEAK');
                }""")
                assert page.locator("#usage-date").inner_text().startswith(
                    "NOV 04, 2026"
                ), "dated snapshot missing from bottom stream"
                if (width, height) == (390, 844):
                    # Falsification: malformed snapshots clear the ONLY stream value;
                    # returning to a valid snapshot restores it.
                    snapshot_url = "**/v2/usage-snapshot.json"
                    page.route(snapshot_url, lambda route: route.fulfill(
                        status=200, content_type="application/json",
                        body='{"version":1,"count":-1}'
                    ))
                    page.evaluate("document.getElementById('refresh-usage').click()")
                    page.wait_for_function("""() =>
                      document.querySelector('#usage-value')?.textContent?.trim() === '—' &&
                      document.querySelector('#usage-status')?.textContent?.includes('SNAPSHOT UNAVAILABLE')
                    """)
                    page.unroute(snapshot_url)
                    page.evaluate("document.getElementById('refresh-usage').click()")
                    page.wait_for_function("""() =>
                      document.querySelector('#usage-value')?.textContent?.trim() === '≈2.7B'
                    """)
            else:
                assert page.locator("#usage-value").inner_text().strip() == "—"
            if (width, height) in [(390, 700), (390, 844), (1440, 900)]:
                for selector in ["#usage-value", ".telemetry-profile-link"]:
                    assert page.locator(selector).evaluate("""el => {
                      const box = el.getBoundingClientRect();
                      return box.width > 0 && box.height > 0 &&
                        box.top >= 0 && box.bottom <= innerHeight;
                    }"""), "GPT stream element not in initial viewport: " + selector
            assert page.locator(".portrait-figure").evaluate(
                "el => el.complete && el.naturalWidth > 0"
            ), "portrait failed to decode"
            motion = page.locator("#motion-toggle")
            assert motion.is_enabled(), "explicit motion opt-in control should remain available"
            shell = page.locator("#interface-shell")
            assert shell.get_attribute("data-motion") == "off", "reduce-motion default ignored"
            # In auto mode a device setting change follows the new preference.
            page.emulate_media(reduced_motion="no-preference")
            page.wait_for_function('document.querySelector("#interface-shell").dataset.motion === "on"')
            page.emulate_media(reduced_motion="reduce")
            page.wait_for_function('document.querySelector("#interface-shell").dataset.motion === "off"')
            # An intentional on-site opt-in takes precedence for this site alone.
            motion.click()
            assert shell.get_attribute("data-motion") == "on"
            smoke = page.locator(".smoke-amber")
            try:
                page.wait_for_function("""() => {
                    const el = document.querySelector('.smoke-amber');
                    return el && getComputedStyle(el).animationName.includes('vapor-wander');
                }""", timeout=2500)
            except Exception as error:
                details = page.evaluate("""() => {
                  const el = document.querySelector('.smoke-amber');
                  const shell = document.querySelector('#interface-shell');
                  const style = getComputedStyle(el);
                  return {
                    motion: shell.dataset.motion,
                    className: el.className,
                    animationName: style.animationName,
                    animationDuration: style.animationDuration,
                    opacity: style.opacity,
                    background: style.backgroundImage,
                    stylesheets: [...document.styleSheets].map(s => ({
                      href: s.href, rules: s.cssRules?.length,
                      hasVapor: [...s.cssRules].some(r => r.cssText.includes('vapor-wander'))
                    }))
                  };
                }""")
                raise AssertionError("Smoke animation did not engage: " + str(details)) from error
            first_transform = smoke.evaluate("el => getComputedStyle(el).transform")
            # Headless GPU scheduling can delay a rendered frame; verify real
            # progression rather than assuming one appears within 300ms.
            try:
                page.wait_for_function("""previous => {
                    const el = document.querySelector('.smoke-amber');
                    return getComputedStyle(el).transform !== previous;
                }""", arg=first_transform, timeout=3000)
            except Exception as error:
                state = smoke.evaluate("""el => ({
                    transform: getComputedStyle(el).transform,
                    animation: getComputedStyle(el).animationName,
                    state: el.getAnimations().map(a => ({playState:a.playState, currentTime:a.currentTime}))
                })""")
                raise AssertionError("Smoke failed to advance its animated transform: " + str(state)) from error
            motion.click()
            assert shell.get_attribute("data-motion") == "off"
            assert smoke.evaluate("el => getComputedStyle(el).animationName") == "none"
            motion.click()
            assert shell.get_attribute("data-motion") == "on"
            if origin:
                page.reload(wait_until="load")
                assert page.locator("#interface-shell").get_attribute("data-motion") == "on", "motion opt-in did not persist"


            def check_overflow(view):
                observed = page.evaluate("""() => {
                    const active = document.querySelector('[data-panel]:not([hidden])');
                    return {
                      docX: document.documentElement.scrollWidth - innerWidth,
                      docY: document.documentElement.scrollHeight - innerHeight,
                      panelX: active.scrollWidth - active.clientWidth,
                      orientation: document.querySelector('.rail').getAttribute('aria-orientation')
                    };
                }""")
                assert observed["docX"] <= 1 and observed["docY"] <= 1, (view, observed)
                assert observed["panelX"] <= 1, (view, observed)
                assert observed["orientation"] == (
                    "horizontal" if width <= 960 else "vertical"
                ), observed

            # Detect Safari-style stale CSS: these links must be actual flex cards,
            # never raw underlined text after an HTML-only update.
            cards = page.locator(".hero-feature-link")
            card_style = cards.first.evaluate("""el => {
              const style = getComputedStyle(el);
              return {display: style.display, decoration: style.textDecorationLine,
                      border: parseFloat(style.borderTopWidth)};
            }""")
            assert card_style["display"] == "grid" and card_style["decoration"] == "none", (
                label, "Unstyled project link", card_style
            )
            assert card_style["border"] >= 1, (label, "Project card border missing", card_style)
            profile_style = page.locator(".telemetry-profile-link").evaluate("""el => {
              const style = getComputedStyle(el);
              return {display: style.display, decoration: style.textDecorationLine,
                      border: parseFloat(style.borderTopWidth)};
            }""")
            # CSS grid blockifies inline-flex into flex; either is correct.
            assert profile_style["display"] in ["flex", "inline-flex"], (label, profile_style)
            assert page.locator(".telemetry-profile-label").inner_text() == "View profile"
            assert page.locator(".telemetry-profile-link").get_attribute("aria-label") == "View profile — full GPT activity and skills"
            assert profile_style["decoration"] == "none" and profile_style["border"] >= 1, (
                label, "GPT profile action has stale/missing styles", profile_style
            )
            # Retain Merit/Rhen language highlights and use the Observatory as the only
            # ChatGPT activity stream.
            featured = page.locator(".hero-feature")
            assert featured.is_visible(), "Merit/Rhen language highlights not visible"
            assert page.locator(".hero-feature-link").count() == 2
            assert page.locator(".focus-heading h2").inner_text() == "Active development"
            assert page.locator(".focus-project-state").all_inner_texts() == ["Active", "Research"]
            assert page.locator(".focus-project-state").first.evaluate(
                "el => ['inline-flex', 'flex'].includes(getComputedStyle(el).display)"
            ), "Project status must retain its inline indicator layout"
            assert "ACTIVE ENGINEERING" not in featured.inner_text()
            assert "LANGUAGE RESEARCH / PROPOSED" not in featured.inner_text()
            assert page.locator(".hero-feature-link").nth(0).get_attribute("href") == "/work/merit/"
            assert page.locator(".hero-feature-link").nth(1).get_attribute("href") == "/work/rhen-language/"
            assert page.locator(".hero-usage").count() == 0
            check_overflow("home")
            # On normal portrait-phone and desktop viewports the featured project
            # cards must be in the initial panel viewport, not clipped below it.
            if (width, height) in [(390, 700), (390, 844), (1440, 900)]:
                # Desktop stays above the fold. Phones may scroll their content
                # panel, but the cards must be reachable without nav overlap.
                if width <= 460:
                    # Compact portrait cards stack to prevent unreadable tiny labels.
                    assert page.locator(".focus-grid").evaluate(
                        "el => getComputedStyle(el).gridTemplateColumns.split(' ').length === 1"
                    ), "Mobile cards must be in a single column"
                    featured.scroll_into_view_if_needed()
                # The outer feature wrapper may end exactly at the scroll
                # boundary while its last visible card still has safe clearance.
                # Measure the painted card, not the invisible wrapper margin.
                feature_box = featured.bounding_box()
                last_card = page.locator(".hero-feature-link").last.bounding_box()
                panel_box = page.locator("#panel-home").bounding_box()
                assert feature_box and panel_box and last_card
                assert feature_box["y"] >= panel_box["y"] - 1, (label, feature_box, panel_box)
                assert (last_card["y"] + last_card["height"]
                        <= panel_box["y"] + panel_box["height"] + 1), (
                    label, "Last Merit/Rhen language card clipped by fixed navigation", last_card, panel_box
                )
            if width <= 960:
                # The GPT stream and navigation remain in their dedicated rows.
                positions = page.evaluate("""() => {
                  const nav = document.querySelector('.rail').getBoundingClientRect();
                  const feed = document.querySelector('.telemetry').getBoundingClientRect();
                  const link = document.querySelector('.telemetry-profile-link').getBoundingClientRect();
                  return {navBottom: nav.bottom, feedTop: feed.top, feedBottom: feed.bottom,
                          linkTop: link.top, linkBottom: link.bottom,
                          linkRight: link.right, viewport: innerWidth};
                }""")
                assert positions["navBottom"] <= positions["feedTop"] + 2, (label, positions)
                assert positions["linkTop"] >= positions["feedTop"] - 1, (label, positions)
                assert positions["linkBottom"] <= positions["feedBottom"] + 1, (label, positions)
                assert positions["linkRight"] <= positions["viewport"] + 1, (label, positions)
            mobile = width <= 960
            light = page.locator("#mobile-light" if mobile else "#shift-light")
            assert light.is_visible(), "portrait lighting control missing"
            if mobile:
                bounds = light.bounding_box()
                assert bounds and bounds["width"] >= 44 and bounds["height"] >= 44, bounds
            light.click()
            assert page.locator("#interface-shell").get_attribute("data-light") == "teal"
            assert "teal" in light.get_attribute("aria-label")
            light.click()
            assert page.locator("#interface-shell").get_attribute("data-light") == "violet"

            page.locator("#tab-home").focus()
            page.keyboard.press("ArrowRight" if mobile else "ArrowDown")
            assert page.locator("#tab-work").get_attribute("aria-selected") == "true"
            assert page.locator("#tab-work").evaluate(
                "el => document.activeElement === el"
            ), "tab focus didn't follow selection"
            check_overflow("work")
            page.locator("#tab-writing").click()
            assert page.locator("#panel-writing").is_visible()
            check_overflow("writing")
            page.evaluate("history.back()")
            page.wait_for_function(
                'document.querySelector("#tab-work").getAttribute("aria-selected") === "true"'
            )
            page.evaluate('location.hash = "#%E0%A4%A"')
            page.wait_for_timeout(80)
            assert page.locator("#panel-work").is_visible(), "malformed hash changed view"
            page.evaluate('location.hash = "#main"')
            page.wait_for_timeout(80)
            assert page.locator("#panel-work").is_visible(), "skip anchor changed view"
            page.locator("#tab-contact").click()
            assert page.locator("#panel-contact").is_visible()
            check_overflow("contact")
            assert "devon@anevum.com" in page.locator("#panel-contact").inner_text()

            # New sixth view and site-wide presence signal: inspect real layout
            # and keyboard/touch behavior on all supported responsive sizes.
            assert page.locator("#tab-listening").count() == 1
            assert page.locator("#presence-ticker").is_visible()
            presence_box = page.locator("#presence-ticker").bounding_box()
            assert presence_box and presence_box["width"] >= 70, (label, presence_box)
            assert presence_box["x"] >= 0 and (
                presence_box["x"] + presence_box["width"] <= width + 1
            ), (label, "ticker clipped", presence_box)
            page.locator("#tab-listening").click()
            assert page.locator("#panel-listening").is_visible()
            check_overflow("listening")
            assert page.locator("#listening-track-title").is_visible()
            assert page.locator("#tab-listening").get_attribute("aria-selected") == "true"
            if origin and (width, height) in [(390, 844), (1440, 900)]:
                presence_path = "**/api/listening/now"
                live_body = json.dumps({
                    "version": 1,
                    "mode": "playing",
                    "detailsVisible": True,
                    "updatedAt": page.evaluate("new Date().toISOString()"),
                    "track": {
                        "title": "Synthetic QA track",
                        "artist": "Synthetic QA artist",
                        "url": "https://open.spotify.com/track/1234567890123456789012",
                    },
                })
                page.route(presence_path, lambda route: route.fulfill(
                    status=200, content_type="application/json", body=live_body
                ))
                page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
                page.wait_for_function("""() =>
                    document.querySelector('#listening-track-title')?.textContent === 'Synthetic QA track'
                """)
                assert page.locator("#listening-track-title").inner_text() == "Synthetic QA track"
                assert page.locator("#presence-ticker-label").inner_text() != "IN THE ZONE", "music alone must not imply development"
                assert page.locator("#listening-open-track").get_attribute("href").startswith(
                    "https://open.spotify.com/track/"
                )
                page.unroute(presence_path)
                page.route(presence_path, lambda route: route.fulfill(
                    status=200, content_type="application/json",
                    body='{"version":1,"mode":"hidden","detailsVisible":false}'
                ))
                page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
                page.wait_for_function("""() =>
                    document.querySelector('#listening-visibility')?.textContent === 'PRIVATE BY DEFAULT'
                """)
                assert "Synthetic QA track" not in page.locator("#panel-listening").inner_text()
                assert page.locator("#listening-open-track").is_hidden()
                page.unroute(presence_path)
                # Independent, expiring owner-declared presence. Music alone
                # above did not activate this signal.
                presence_fixture = {
                    "version":1,"visibility":"public","state":"developing",
                    "asOf":page.evaluate("new Date().toISOString()"),
                    "source":"owner-declared","project":"Merit"
                }
                page.route("**/api/presence/public", lambda route: route.fulfill(
                    status=200,content_type="application/json",body=json.dumps(presence_fixture)
                ))
                page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
                page.wait_for_function("document.querySelector('#presence-ticker-label')?.textContent === 'DEVELOPING'")
                assert "OWNER-DECLARED" in page.locator("#presence-ticker-detail").inner_text()
                presence_fixture.update({"state":"working-privately","asOf":None,"source":"none","project":None})
                page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
                page.wait_for_function("document.querySelector('#presence-ticker-label')?.textContent === 'WORKING PRIVATELY'")
                assert page.locator("#presence-ticker-detail").is_hidden()
                presence_fixture.update({"visibility":"hidden","state":"not-broadcasting"})
                page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
                page.wait_for_function("document.querySelector('#presence-ticker-label')?.textContent === 'NOT BROADCASTING'")
                page.unroute("**/api/presence/public")
                playlist_fixture = {"version":1,"status":"available","checkedAt":page.evaluate("new Date().toISOString()"),
                    "playlists":[{"id":"1234567890123456789012","title":"Synthetic playlist","url":"https://open.spotify.com/playlist/1234567890123456789012","image":None}]}
                page.route("**/api/listening/collections",lambda route:route.fulfill(status=200,content_type="application/json",body=json.dumps(playlist_fixture)))
                page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
                page.wait_for_function("document.querySelectorAll('.listening-playlist-link').length === 1")
                assert "Synthetic playlist" in page.locator("#listening-playlists").inner_text()
                playlist_fixture.update({"status":"hidden","checkedAt":None,"playlists":[]})
                page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
                page.wait_for_function("document.querySelector('#listening-playlists').hidden")
                assert page.locator(".listening-playlist-link").count() == 0
                page.unroute("**/api/listening/collections")
            page.locator("#tab-contact").click()
            assert page.locator("#panel-contact").is_visible()

            violations = []
            if axe_source:
                page.add_script_tag(content=axe_source)
                violations = page.evaluate("""async () => {
                  const tags = ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'];
                  const r = await axe.run(document, {
                    runOnly: {type:'tag', values:tags}
                  });
                  return r.violations.map(v => ({
                    id:v.id, impact:v.impact,
                    nodes:v.nodes.map(n=>n.target).slice(0,5)
                  }));
                }""")
                assert not violations, f"Axe WCAG violations: {violations}"
            if origin:
                root_response = page.goto(origin + "/", wait_until="load")
                assert root_response and root_response.status == 200
                root_html = page.content()
                assert 'rel="canonical" href="https://devonakins.com/"' in root_html
                assert 'name="robots" content="noindex' not in root_html
                assert "V2 PREVIEW" not in root_html
                page.locator("#panel-home").wait_for(state="visible")
                assert page.locator(".portrait-figure").evaluate(
                    "el => el.complete && el.naturalWidth > 0"
                ), "canonical homepage portrait failed to decode"
                check_overflow("canonical-home")
                assert page.locator(".hero-feature").is_visible(), "canonical Merit/Rhen language missing"
                assert page.locator(".focus-project-copy").count() == 2
                assert page.locator(".hero-usage").count() == 0, "duplicate hero metric"
                assert page.locator(".telemetry-profile-link").get_attribute("href") == "/gpt/"
                page.wait_for_function(
                    """() => document.querySelector('#usage-value')?.textContent?.trim() === '≈2.7B'""",
                    timeout=7000,
                )
                assert "25D STREAK" in page.locator("#usage-status").inner_text()
                assert "314.2M PEAK" in page.locator("#usage-status").inner_text()
                assert page.locator("#usage-date").inner_text().startswith("NOV 04, 2026")
                report = page.request.get(origin + "/v2/usage-snapshot.json")
                assert report.status == 200, "snapshot endpoint failed"
                assert "application/json" in report.headers.get("content-type", "")
                assert report.json()["count"] == 2700000000
                page.locator("#tab-writing").click()
                assert page.locator("#panel-writing").is_visible()
                if axe_source:
                    page.add_script_tag(content=axe_source)
                    root_violations = page.evaluate("""async () => {
                      const tags = ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'];
                      const report = await axe.run(document, {
                        runOnly: {type:'tag', values:tags}
                      });
                      return report.violations.map(v => ({
                        id:v.id, nodes:v.nodes.map(n=>n.target).slice(0,5)
                      }));
                    }""")
                    assert not root_violations, f"Canonical home axe violations: {root_violations}"

            if origin and (width, height) in [(320, 568), (390, 844), (1440, 900)]:
                # Exercise the actual GPT route on small mobile, standard mobile and desktop
                # in both browser engines. Other legacy routes are covered at 390x844.
                deep_routes = ["/gpt/"]
                if (width, height) == (390, 844):
                    deep_routes.extend([
                        "/work/", "/source/", "/about/", "/contact/",
                        "/work/operations/", "/work/writing/", "/work/anevum/",
                        "/work/ideaflow/", "/work/devonstation/",
                        "/work/merit/", "/work/mizvo/", "/work/rhen-language/",
                        "/work/vesper/", "/work/squelch/", "/work/brandicade/", "/work/rhen/",
                    ])
                for route in deep_routes:
                    if route == "/gpt/":
                        # Deterministic browser fixture exercises populated data without
                        # depending on GitHub egress, real accounts or private content.
                        from datetime import datetime, timedelta, timezone
                        clock = datetime.now(timezone.utc)
                        def event_time(minutes_ago):
                            return (clock - timedelta(minutes=minutes_ago)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                        events = [
                            {"at": event_time(1), "kind": "push"},
                            {"at": event_time(3), "kind": "pull request"},
                            {"at": event_time(5), "kind": "release"},
                        ]
                        public_fixture = {
                            "version": 1,
                            "gpt": {"freshness": "historical", "asOf": "2026-11-04"},
                            "development": {
                                "source": "GitHub public events API", "freshness": "current",
                                "checkedAt": clock.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                                "status": "available", "failureReason": None, "retryAt": None,
                                "latestActivityAt": events[0]["at"],
                                "latestActivityKind": events[0]["kind"], "recentActivity": events,
                            },
                        }
                        page.route("**/api/telemetry/public", lambda route: route.fulfill(
                            status=200, content_type="application/json",
                            body=json.dumps(public_fixture),
                        ))
                        observation_fixture = {
                            "version": 1, "status": "recent",
                            "observation": {
                                "version": 1, "status": "recent",
                                "metric": "work_codex_credits_remaining",
                                "value": 42.5, "unit": "credits",
                                "scope": "work-codex",
                                "source": "user-selected-visible-usage-text",
                                "observedAt": event_time(1),
                                "lastChangedAt": event_time(10),
                                "sourceUpdatedAt": None,
                                "receivedAt": event_time(0),
                            },
                        }
                        page.route("**/api/gpt-observation/latest", lambda route: route.fulfill(
                            status=200, content_type="application/json",
                            body=json.dumps(observation_fixture),
                        ))
                    response = page.goto(origin + route, wait_until="load")
                    assert response and response.status == 200, route
                    assert page.locator("#interface-shell").get_attribute("data-route-page") == "true", route
                    assert page.locator(".route-content").is_visible(), route
                    assert page.locator(".portrait-figure").evaluate(
                        "el => el.complete && el.naturalWidth > 0"
                    ), "portrait decode: " + route
                    assert not page.locator(".site-header").count(), route
                    check_overflow("deep link " + route)
                    if route == "/gpt/":
                        assert page.locator("#gpt-profile").is_visible()
                        assert "314.2M" in page.locator("#gpt-profile").inner_text()
                        assert "621.7M" in page.locator("#gpt-profile").inner_text()
                        assert "Showcase Sites" not in page.locator("#gpt-profile").inner_text()
                        assert page.locator(".gpt-weekly-metric").count() == 4
                        assert page.locator("#gpt-event-list").count() == 1
                        assert page.locator(".gpt-live-panel").is_visible()
                        page.locator("#gpt-observation-panel").wait_for(state="visible")
                        assert "42.5 credits remaining" in page.locator("#gpt-observation-value").inner_text()
                        assert "RECENT OBSERVATION" in page.locator("#gpt-observation-state").inner_text()
                        assert "OpenAI update time unknown" in page.locator("#gpt-observation-age").inner_text()
                        assert page.locator("[data-gpt-event-filter]").count() == 4
                        if width == 320:
                            # Confirm a symmetric 2x2 set of real touch targets on narrow phones.
                            # Read all geometry in one animation frame; sequential
                            # locator queries can span a route-transition frame.
                            layout = page.locator(".gpt-live-filters").evaluate("""el => {
                                const style = getComputedStyle(el);
                                return {
                                    display: style.display,
                                    columns: style.gridTemplateColumns.trim().split(/\s+/).length,
                                    boxes: [...el.querySelectorAll('button')].map(b => {
                                        const rect = b.getBoundingClientRect();
                                        return {x: rect.x, y: rect.y, height: rect.height};
                                    })
                                };
                            }""")
                            assert layout["display"] == "grid", layout
                            assert layout["columns"] == 2, layout
                            boxes = layout["boxes"]
                            assert len(boxes) == 4 and all(b["height"] >= 44 for b in boxes), layout
                            assert abs(boxes[0]["y"] - boxes[1]["y"]) < 2, layout
                            assert abs(boxes[2]["y"] - boxes[3]["y"]) < 2, layout
                            assert boxes[2]["y"] > boxes[0]["y"] + 40, layout
                            assert boxes[0]["x"] < boxes[1]["x"], layout
                        page.locator("#gpt-event-list .gpt-event-card").first.wait_for(state="visible")
                        assert page.locator("#gpt-event-list .gpt-event-card").count() == 3
                        assert page.locator(".gpt-live-panel").get_attribute("data-source-state") == "ready"
                        assert page.locator("#gpt-diagnostic-actions").is_hidden()
                        assert "Source checked" in page.locator("#gpt-event-state").inner_text()
                        assert "PUBLIC PUSH" in page.locator("#gpt-event-list").inner_text()
                        # Screenshot only the sanitized synthetic data, never live account details.
                        # The element screenshot captures the whole panel, even inside the
                        # smaller viewport's scrolling content region.
                        output.mkdir(parents=True, exist_ok=True)
                        page.locator(".gpt-live-panel").screenshot(
                            path=str(output / f"synthetic-gpt-feed-{label}.png"),
                            animations="disabled",
                        )
                        page.locator('[data-gpt-event-filter="pull request"]').click()
                        assert page.locator("#gpt-event-list .gpt-event-card").count() == 1
                        assert "PULL REQUEST" in page.locator("#gpt-event-list").inner_text()
                        assert "PUBLIC PUSH" not in page.locator("#gpt-event-list").inner_text()
                        assert page.locator('[data-gpt-event-filter="pull request"]').get_attribute("aria-pressed") == "true"
                        assert page.locator('[data-gpt-event-filter="all"]').get_attribute("aria-pressed") == "false"
                        page.locator('[data-gpt-event-filter="all"]').click()
                        assert page.locator("#gpt-event-list .gpt-event-card").count() == 3
                        if (width, height) == (390, 844):
                            observation_fixture["status"] = "stale"
                            observation_fixture["observation"]["status"] = "stale"
                            observation_fixture["observation"]["observedAt"] = event_time(40)
                            observation_fixture["observation"]["lastChangedAt"] = event_time(50)
                            page.reload(wait_until="load")
                            page.wait_for_function("""() =>
                                document.querySelector('#gpt-observation-panel')?.dataset.freshness === 'stale'
                            """)
                            assert "STALE OBSERVATION" in page.locator("#gpt-observation-state").inner_text()
                            observation_fixture.update({"status": "no-data", "observation": None})
                            page.reload(wait_until="load")
                            page.wait_for_function("""() =>
                                document.querySelector('#gpt-observation-panel')?.hidden === true
                            """)
                            assert page.locator("#gpt-observation-panel").is_hidden()
                            observation_fixture["status"] = "recent"
                            observation_fixture["observation"] = {
                                "version": 1, "status": "recent",
                                "metric": "work_codex_credits_remaining",
                                "value": 42.5, "unit": "credits", "scope": "work-codex",
                                "source": "user-selected-visible-usage-text",
                                "observedAt": event_time(1), "lastChangedAt": event_time(10),
                                "sourceUpdatedAt": None, "receivedAt": event_time(0),
                            }
                            page.reload(wait_until="load")
                            page.locator("#gpt-observation-panel").wait_for(state="visible")
                            observation_fixture["observation"]["metric"] = "work_codex_used_percent"
                            observation_fixture["observation"]["unit"] = "percent"
                            observation_fixture["observation"]["value"] = 42
                            page.reload(wait_until="load")
                            page.locator("#gpt-observation-panel").wait_for(state="visible")
                            assert "42% used" in page.locator("#gpt-observation-value").inner_text()
                            # Falsify freshness: a stale upstream checkedAt must fail closed
                            # and replace every previously displayed card with unavailable.
                            valid_checked_at = public_fixture["development"]["checkedAt"]
                            public_fixture["development"]["checkedAt"] = "2000-01-01T00:00:00.000Z"
                            page.reload(wait_until="load")
                            page.wait_for_function("""() =>
                                document.querySelector('.gpt-live-panel')?.dataset.sourceState === 'unavailable'
                            """)
                            assert page.locator("#gpt-event-list .gpt-event-card").count() == 0
                            assert "unavailable" in page.locator("#gpt-event-state").inner_text().lower()
                            # A fresh, independently validated provider response can recover.
                            public_fixture["development"]["checkedAt"] = valid_checked_at
                            page.reload(wait_until="load")
                            page.wait_for_function("""() =>
                                document.querySelector('.gpt-live-panel')?.dataset.sourceState === 'ready'
                            """)
                            assert page.locator("#gpt-event-list .gpt-event-card").count() == 3
                            assert "Source checked" in page.locator("#gpt-event-state").inner_text()
                            # A valid rate-limit response must explain the failure without
                            # exposing raw upstream headers or pretending to have live data.
                            original_development = dict(public_fixture["development"])
                            public_fixture["development"].update({
                                "freshness": "unavailable",
                                "status": "unavailable",
                                "failureReason": "rate-limited",
                                "retryAt": event_time(-30),
                                "latestActivityAt": None,
                                "latestActivityKind": None,
                                "recentActivity": [],
                            })
                            page.reload(wait_until="load")
                            page.wait_for_function("""() =>
                                document.querySelector('.gpt-live-panel')?.dataset.sourceState === 'unavailable'
                            """)
                            assert page.locator("#gpt-event-list .gpt-event-card").count() == 0
                            assert "limiting unauthenticated public requests" in page.locator("#gpt-event-state").inner_text()
                            assert "Retry is permitted after" in page.locator("#gpt-event-state").inner_text()
                            assert page.locator("#gpt-diagnostic-actions").is_visible()
                            page.evaluate("""() => {
                                Object.defineProperty(navigator, 'clipboard', {
                                    configurable: true,
                                    value: {writeText: async (value) => {window.__copiedPublicDiagnostics = value;}},
                                });
                            }""")
                            page.locator("#gpt-copy-diagnostics").click()
                            assert "Diagnostics copied" in page.locator("#gpt-copy-status").inner_text()
                            copied = page.evaluate("window.__copiedPublicDiagnostics")
                            assert "Reason: rate-limited" in copied
                            assert "Source checked (UTC): " in copied
                            assert "Retry eligible (UTC): " in copied
                            assert "historical snapshot (not live)" in copied
                            assert "do not leak" not in copied
                            assert page.locator("#gpt-diagnostic-manual").is_hidden()
                            # Safari-style denial must expose the same sanitized report for
                            # manual text selection instead of leaving an inert button.
                            page.evaluate("""() => {
                                Object.defineProperty(navigator, 'clipboard', {
                                    configurable: true,
                                    value: {writeText: async () => {throw new Error('denied');}},
                                });
                            }""")
                            page.locator("#gpt-copy-diagnostics").click()
                            manual = page.locator("#gpt-diagnostic-manual")
                            assert manual.is_visible()
                            assert "Clipboard blocked" in page.locator("#gpt-copy-status").inner_text()
                            assert "Reason: rate-limited" in manual.input_value()
                            assert "historical snapshot (not live)" in manual.input_value()
                            assert "do not leak" not in manual.input_value()
                            assert manual.evaluate("e => e.selectionStart === 0 && e.selectionEnd === e.value.length")
                            assert "do not leak" not in page.locator("#gpt-profile").inner_text()
                            public_fixture["development"].clear()
                            public_fixture["development"].update(original_development)
                            page.reload(wait_until="load")
                            page.wait_for_function("""() =>
                                document.querySelector('.gpt-live-panel')?.dataset.sourceState === 'ready'
                            """)
                            assert page.locator("#gpt-event-list .gpt-event-card").count() == 3
                            assert page.locator("#gpt-diagnostic-actions").is_hidden()
                            assert page.locator("#gpt-diagnostic-manual").is_hidden()
                            assert page.locator("#gpt-diagnostic-manual").input_value() == ""
                        assert "Skills & workflows" in page.locator("#gpt-profile").inner_text()
                        assert "Activity graph" in page.locator("#gpt-profile").inner_text()
                        assert "Profile insights" in page.locator("#gpt-profile").inner_text()
                        assert not page.locator("#home-usage-value").count()
                    if axe_source and route in ["/work/", "/work/ideaflow/", "/work/merit/", "/work/mizvo/", "/work/rhen-language/", "/contact/", "/gpt/"]:
                        page.add_script_tag(content=axe_source)
                        link_violations = page.evaluate("""async () => {
                          const tags = ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'];
                          const r = await axe.run(document, {
                            runOnly: {type:'tag',values:tags}
                          });
                          return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target).slice(0,5)}));
                        }""")
                        assert not link_violations, f"{route}: {link_violations}"
                    page.locator("#tab-home").click()
                    page.wait_for_url(origin + "/#home")
                    assert page.locator("#panel-home").is_visible(), route + " canonical navigation"
            if origin and (width, height) == (390, 844):
                listening_page = page.goto(origin + "/listening/", wait_until="load")
                assert listening_page and listening_page.status == 200
                assert page.locator("#interface-shell").get_attribute("data-route-page") == "true"
                assert page.locator("#interface-shell").get_attribute("data-initial-view") == "listening"
                assert page.locator("#panel-listening").is_visible()
                assert page.locator("#tab-listening").get_attribute("aria-selected") == "true"
                assert page.locator("#presence-ticker").is_visible()
                check_overflow("listening deep link")
                if axe_source:
                    page.add_script_tag(content=axe_source)
                    listening_violations = page.evaluate("""async () => {
                      const r = await axe.run(document, {
                        runOnly: {type:'tag', values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}
                      });
                      return r.violations.map(v => ({id:v.id,nodes:v.nodes.map(n=>n.target).slice(0,5)}));
                    }""")
                    assert not listening_violations, f"/listening/ axe WCAG: {listening_violations}"
                page.locator("#tab-home").click()
                page.wait_for_url(origin + "/#home")
                assert page.locator("#panel-home").is_visible()

            assert not errors, f"page errors: {errors}"
            results.append({
                "engine": engine, "viewport": [width, height], "tabs": "passed",
                "history": "passed", "lighting": "passed",
                "axe_violations": len(violations) if axe_source else "not-run"
            })
            print(
                f"PASS {label}: portrait, reflow, keyboard, history, lighting"
                + (", axe WCAG" if axe_source else ", axe not run")
            )
        except Exception:
            output.mkdir(parents=True, exist_ok=True)
            try:
                page.screenshot(path=str(output / f"failed-{label}.png"), full_page=True)
            except Exception:
                pass
            raise
        finally:
            context.close()
    return results



def check_owner_control(browser, engine, origin, output, axe_source):
    """Inspect the real first-party owner markup without any Spotify account."""
    if not origin:
        return []
    markup = subprocess.check_output([
        "node", "--input-type=module", "-e",
        "import {renderListeningOwner} from './src/listening-owner-page.mjs';"
        "process.stdout.write(renderListeningOwner());",
    ], text=True)
    results = []
    for width, height in [(320, 700), (390, 844), (768, 900), (1440, 900)]:
        context = browser.new_context(viewport={"width": width, "height": height},
                                      reduced_motion="reduce")
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        label = f"owner-{engine}-{width}x{height}"
        try:
            page.route("**/owner/listening/", lambda route: route.fulfill(status=200,content_type="text/html; charset=utf-8",body=markup))
            spotify_status = {
                "connected": True, "spotifyAppConfigured": True,
                "reauthorizationRequired": False,
                "publishingAllowed": False, "publicEnabled": False,
                "showDetails": False, "reauthorizeBy": "2027-05-05T00:00:00.000Z",
            }
            page.route("**/api/listening/admin/status", lambda route: route.fulfill(
                status=200, content_type="application/json",
                body=json.dumps(spotify_status)
            ))
            page.goto(origin + "/owner/listening/",wait_until="load")
            page.wait_for_function("""() =>
              document.querySelector('#connection-state')?.textContent === 'CONNECTED'
            """)
            assert page.locator("#connect").is_enabled()
            assert page.locator("#disconnect").is_enabled()
            assert page.locator("#public-status").is_disabled()
            assert page.locator("#track-details").is_disabled()
            assert page.locator("#save-settings").is_disabled()
            assert page.locator("h1").inner_text().startswith("Listen anywhere.")
            geometry = page.evaluate("""() => ({
              overflow: document.documentElement.scrollWidth - innerWidth,
              button: document.querySelector('#connect').getBoundingClientRect(),
              width: innerWidth,
            })""")
            assert geometry["overflow"] <= 1, (label, "horizontal overflow", geometry)
            assert geometry["button"]["width"] >= 80, (label, "tiny touch control", geometry)
            assert page.locator("#spotify-setup").is_hidden()
            assert page.locator("#preview-playback").is_enabled()
            # The private test is manual and uses no public listening endpoint.
            preview_fixture = {
                "private": True, "mode": "playing", "updatedAt": "2026-11-06T21:00:00.000Z",
                "track": {"title": "Synthetic track", "artist": "<unsafe artist>"},
            }
            page.route("**/api/listening/admin/preview", lambda route: route.fulfill(
                status=200, content_type="application/json", body=json.dumps(preview_fixture)
            ))
            page.locator("#preview-playback").click()
            page.wait_for_function("""() =>
              document.querySelector('#preview-status')?.textContent?.includes('Synthetic track')
            """)
            assert "<unsafe artist>" in page.locator("#preview-status").inner_text()
            assert page.locator("#preview-status img").count() == 0
            assert "nothing was published" in page.locator("#preview-status").inner_text()
            preview_fixture.update({"mode": "off_air", "track": None})
            page.locator("#preview-playback").click()
            page.wait_for_function("""() =>
              document.querySelector('#preview-status')?.textContent?.includes('No active Spotify track')
            """)
            assert page.locator("#preview-playback").is_enabled()
            page.unroute("**/api/listening/admin/preview")
            # An unconfigured Spotify app must never offer a dead OAuth action.
            spotify_status.update({"connected": False, "spotifyAppConfigured": False})
            page.reload(wait_until="load")
            page.wait_for_function("""() =>
              document.querySelector('#connection-state')?.textContent === 'SETUP REQUIRED'
            """)
            assert page.locator("#connect").is_disabled()
            assert page.locator("#preview-playback").is_disabled()
            assert page.locator("#spotify-setup").is_visible()
            assert "SPOTIFY_CLIENT_ID" in page.locator("#spotify-setup").inner_text()
            assert page.locator("#spotify-setup code").first.inner_text() == (
                "https://devonakins.com/api/listening/oauth/callback"
            )
            assert page.evaluate("document.documentElement.scrollWidth - innerWidth") <= 1, (
                label, "setup guidance overflow"
            )
            if axe_source:
                page.add_script_tag(content=axe_source)
                violations = page.evaluate("""async () => {
                  const result = await axe.run(document, {
                    runOnly: {type:'tag',
                      values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}
                  });
                  return result.violations.map(v => ({
                    id:v.id, nodes:v.nodes.map(n=>n.target).slice(0,5)
                  }));
                }""")
                assert not violations, f"{label} accessibility: {violations}"
            assert not errors, f"{label} script errors: {errors}"
            output.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(output / f"{label}.png"), full_page=True)
            results.append({"engine": engine, "viewport": [width, height],
                            "owner_page": "passed", "axe": "passed" if axe_source else "not-run"})
            print(f"PASS {label}: private UI, reflow, safe defaults, accessibility")
        except Exception:
            output.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(output / f"failed-{label}.png"), full_page=True)
            raise
        finally:
            context.close()
    return results


def check_presence_control(browser, engine, origin, output, axe_source):
    if not origin:
        return []
    markup = subprocess.check_output(["node", "--input-type=module", "-e",
        "import {renderPresenceOwner} from './src/presence-owner-page.mjs';process.stdout.write(renderPresenceOwner());"], text=True)
    results = []
    for width, height in [(320,700),(390,844),(768,900),(1024,768),(1440,900)]:
        context = browser.new_context(viewport={"width":width,"height":height},reduced_motion="reduce")
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        state = {"revision":0,"publishingAllowed":True,"enabled":False,"privateWork":False,
            "shareListening":False,"paused":False,"sessionExpiresAt":None,"projectSlug":None,
            "manualState":None,"projects":["merit","mizvo"],"projectCatalog":{"merit":"Merit","mizvo":"Mizvo"},
            "preview":{"state":"not-broadcasting","project":None,"source":"none"}}
        writes = []
        delayed = {}
        def respond(route):
            if route.request.method == "POST":
                data = route.request.post_data_json
                writes.append(data)
                state["revision"] += 1
                if data["action"] == "start":
                    state.update({"projectSlug":data["projectSlug"],"sessionExpiresAt":"2026-11-06T18:00:00.000Z"})
                if data["action"] == "off":
                    state.update({"enabled":False,"shareListening":False,"privateWork":False,"sessionExpiresAt":None})
                if data["action"] == "settings":
                    state.update({"enabled":data["enabled"],"privateWork":data["privateWork"],"shareListening":data["shareListening"]})
                if data["action"] == "projects":
                    state["projects"] = data["projects"]
                if data["action"] == "manual":
                    state["preview"] = {"state":data["status"],"label":data.get("label"),"project":None,"source":"owner-manual"}
                if data["action"] == "pause":
                    delayed.update({"route":route,"body":json.dumps(state)})
                    return
            route.fulfill(status=200,content_type="application/json",body=json.dumps(state))
        page.route("**/api/presence/owner",respond)
        cloud = {"revision":0,"enabled":False,"publishingAllowed":False,"paired":False,
            "privatePreview":{"state":"no-signal","source":None,"project":None,"asOf":None,"expiresAt":None,"checkpoint":None}}
        cloud_writes = []
        def cloud_respond(route):
            if route.request.method == "POST":
                data = route.request.post_data_json
                cloud_writes.append(data)
                if data["action"] == "pair":
                    route.fulfill(status=200,content_type="application/json",body=json.dumps({"pairCode":"synthetic-cloud-pairing-code","expiresAt":"2099-01-01T00:00:00.000Z"}))
                    return
            if route.request.method == "DELETE":
                cloud["paired"] = False
                cloud["privatePreview"] = {"state":"no-signal","source":None,"project":None,"asOf":None,"expiresAt":None,"checkpoint":None}
            route.fulfill(status=200,content_type="application/json",body=json.dumps(cloud))
        page.route("**/api/presence/owner?channel=cloud",cloud_respond)
        try:
            page.route("**/owner/presence/",lambda route:route.fulfill(status=200,content_type="text/html; charset=utf-8",body=markup))
            page.goto(origin+"/owner/presence/",wait_until="load")
            page.locator("#session-start").wait_for(state="visible")
            page.wait_for_function("!document.querySelector('#session-start').disabled")
            page.select_option("#presence-project","merit")
            page.locator("#session-start").click()
            page.wait_for_function("document.querySelector('#presence-notice').textContent === 'Saved.'")
            assert writes[-1] == {"action":"start","revision":0,"projectSlug":"merit","minutes":15}
            page.locator("#presence-off").click()
            page.wait_for_function("document.querySelector('#presence-notice').textContent.includes('Broadcasting stopped')")
            assert writes[-1]["action"] == "off" and writes[-1]["revision"] == 1
            assert not page.locator("#presence-enabled").is_checked()
            # Stop must remain usable while an earlier save is still pending.
            # Late successful and failed responses must not replace its state
            # or its confirmed shutdown message.
            for failed in [False,True]:
                page.locator("#presence-enabled").check()
                page.locator("#presence-save").click()
                page.wait_for_function("document.querySelector('#presence-notice').textContent === 'Saved.'")
                delayed.clear()
                page.locator("#session-pause").click()
                page.wait_for_function("document.querySelector('#presence-notice').textContent.includes('Saving')")
                assert page.locator("#presence-off").is_enabled()
                page.locator("#presence-off").click()
                page.wait_for_function("document.querySelector('#presence-notice').textContent.includes('Broadcasting stopped')")
                assert delayed.get("route"), "The earlier request was not held"
                delayed["route"].fulfill(status=409 if failed else 200,content_type="application/json",
                    body=json.dumps({"error":"Stale ordinary save"}) if failed else delayed["body"])
                page.wait_for_function("!document.querySelector('#session-pause').disabled")
                assert not page.locator("#presence-enabled").is_checked()
                assert "Broadcasting stopped" in page.locator("#presence-notice").inner_text()
            page.select_option("#presence-manual","custom")
            page.fill("#presence-custom-label","Editing a new chapter")
            page.locator("#presence-label-approved").check()
            page.locator("#manual-set").click()
            page.wait_for_function("document.querySelector('#presence-notice').textContent === 'Saved.'")
            assert writes[-1]["status"] == "custom" and writes[-1]["labelApproved"] is True
            assert writes[-1]["label"] == "Editing a new chapter"
            page.wait_for_function("document.querySelector('#presence-preview').textContent.includes('Editing a new chapter')")
            page.locator('[data-public-project][value="merit"]').uncheck()
            page.locator("#projects-save").click()
            page.wait_for_function("document.querySelector('#presence-notice').textContent === 'Saved.'")
            assert writes[-1]["action"] == "projects" and writes[-1]["projects"] == ["mizvo"]
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
            assert page.locator("#presence-off").bounding_box()["height"] >= 44
            if axe_source:
                page.add_script_tag(content=axe_source)
                violations = page.evaluate("""async () => (await axe.run(document, {
                    runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}
                })).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))""")
                assert not violations, (engine,width,violations)
            assert page.locator("#cloud-enabled").is_disabled()
            page.locator("#cloud-pair").click()
            page.wait_for_function("!document.querySelector('#cloud-code-wrap').hidden")
            assert page.locator("#cloud-pair-code").input_value() == "synthetic-cloud-pairing-code"
            assert cloud_writes[-1] == {"action":"pair","source":"codex"}
            now = datetime.now(timezone.utc)
            stamp = lambda value: value.isoformat(timespec="milliseconds").replace("+00:00","Z")
            cloud["paired"] = True
            cloud["privatePreview"] = {"state":"running","source":"codex","project":"Mizvo","asOf":stamp(now),"expiresAt":stamp(now+timedelta(seconds=120)),"checkpoint":"testing"}
            page.locator("#cloud-refresh").click()
            page.wait_for_function("document.querySelector('#cloud-preview').textContent.includes('Task running')")
            assert "Mizvo" in page.locator("#cloud-preview").inner_text()
            assert "Task-reported checkpoint: testing" in page.locator("#cloud-confirmed").inner_text()
            cloud["privatePreview"]["state"] = "unknown"
            cloud["privatePreview"]["expiresAt"] = None
            cloud["privatePreview"]["project"] = None
            cloud["privatePreview"]["checkpoint"] = None
            page.locator("#cloud-refresh").click()
            page.wait_for_function("document.querySelector('#cloud-preview').textContent.includes('state unknown')")
            page.locator("#cloud-disconnect").click()
            page.wait_for_function("document.querySelector('#cloud-preview').textContent.includes('No current task signal')")
            assert page.locator("#cloud-code-wrap").is_hidden()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
            assert not errors,errors
            output.mkdir(parents=True,exist_ok=True)
            page.screenshot(path=str(output/f"presence-owner-{engine}-{width}.png"),full_page=True)
            results.append({"engine":engine,"viewport":[width,height],"presence_owner":"passed","axe":"passed" if axe_source else "not-run"})
            print(f"PASS presence-owner-{engine}-{width}: session, delayed success/error shutoff races, reflow, accessibility")
        finally:
            context.close()
    return results


def check_cloud_studio(browser, engine, origin, output, axe_source):
    if not origin:
        return []
    results = []
    for width,height in [(320,700),(390,844),(1440,900)]:
        context = browser.new_context(viewport={"width":width,"height":height},reduced_motion="reduce")
        context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(origin) else route.abort())
        page = context.new_page()
        errors = []
        page.on("pageerror",lambda error:errors.append(str(error)))
        now = datetime.now(timezone.utc)
        stamp = lambda value:value.isoformat(timespec="milliseconds").replace("+00:00","Z")
        signal = {"version":1,"visibility":"public","state":"running","source":"codex","project":"Mizvo","checkpoint":"testing","asOf":stamp(now),"expiresAt":stamp(now+timedelta(seconds=120))}
        page.route("**/api/presence/cloud",lambda route:route.fulfill(status=200,content_type="application/json",body=json.dumps(signal)))
        try:
            page.goto(origin+"/studio/",wait_until="load")
            page.wait_for_function("document.querySelector('[data-cloud-presence]')?.textContent.includes('Task running')")
            assert "Mizvo" in page.locator('[data-cloud-presence]').inner_text()
            assert "Task-reported" in page.locator('[data-cloud-source]').inner_text()
            assert "NOT BROADCASTING" == page.locator('#presence-ticker-label').inner_text()
            # Expired evidence with an otherwise valid payload is unknown.
            signal.update({"asOf":stamp(now-timedelta(seconds=125)),"expiresAt":stamp(now-timedelta(seconds=5))})
            page.reload(wait_until="load")
            page.wait_for_function("document.querySelector('[data-cloud-presence]').textContent === 'Task state unknown'")
            assert "Mizvo" not in page.locator('[data-cloud-presence]').inner_text()
            # Never render unexpected payload fields or private text.
            signal["privateTitle"] = "PRIVATE_SENTINEL"
            page.reload(wait_until="load")
            page.wait_for_function("document.querySelector('[data-cloud-presence]').textContent === 'Not broadcasting'")
            assert "PRIVATE_SENTINEL" not in page.locator('body').inner_text()
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
            if axe_source:
                page.add_script_tag(content=axe_source)
                violations=page.evaluate("""async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))""")
                assert not violations,(engine,width,violations)
            assert not errors,errors
            page.screenshot(path=str(output/f"cloud-studio-{engine}-{width}.png"),full_page=True)
            results.append({"engine":engine,"viewport":[width,height],"cloud_studio":"passed","axe":"passed" if axe_source else "not-run"})
            print(f"PASS cloud-studio-{engine}-{width}: separate task state, stale signal, strict projection, reflow, accessibility")
        finally:
            context.close()
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", type=Path, default=Path("dist"))
    ap.add_argument(
        "--browsers", nargs="+", choices=["chromium", "webkit"],
        default=["chromium", "webkit"]
    )
    ap.add_argument("--axe", action="store_true")
    ap.add_argument(
        "--offline-document", action="store_true",
        help="Fallback for sandboxed local browsers; CI uses real loopback HTTP",
    )
    ap.add_argument(
        "--chromium-path", default=os.environ.get("CHROMIUM_EXECUTABLE")
    )
    ap.add_argument("--webkit-path", default=os.environ.get("WEBKIT_EXECUTABLE"))
    ap.add_argument("--out", type=Path, default=Path("browser-qa"))
    args = ap.parse_args()
    html, css, script = compiled_preview(args.dist)
    static_server = None
    origin = None
    if not args.offline_document:
        static_server, origin = start_static_origin(args.dist)
    axe_source = None
    if args.axe:
        axe_source = Path("node_modules/axe-core/axe.min.js").read_text(
            encoding="utf-8"
        )
    all_results = []
    try:
        with sync_playwright() as playwright:
            for name in args.browsers:
                kwargs = {"headless": True}
                if name == "chromium" and args.chromium_path:
                    kwargs.update({
                        "executable_path": args.chromium_path,
                        "args": ["--no-sandbox"]
                    })
                if name == "webkit" and args.webkit_path:
                    kwargs["executable_path"] = args.webkit_path
                browser = getattr(playwright, name).launch(**kwargs)
                try:
                    all_results.extend(
                        check(browser, name, html, css, script, axe_source, args.out, origin)
                    )
                    all_results.extend(
                        check_owner_control(browser, name, origin, args.out, axe_source)
                    )
                    all_results.extend(check_presence_control(browser,name,origin,args.out,axe_source))
                    all_results.extend(check_cloud_studio(browser,name,origin,args.out,axe_source))
                finally:
                    browser.close()
    finally:
        if static_server:
            static_server.shutdown()
            static_server.server_close()
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "results.json").write_text(
        json.dumps(all_results, indent=2), encoding="utf-8"
    )
    print(f"Verified {len(all_results)} compiled-preview browser configurations")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"BROWSER ACCEPTANCE FAILED: {error}", file=sys.stderr)
        raise
