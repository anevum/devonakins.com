#!/usr/bin/env python3
"""Offline Chromium/WebKit acceptance for the compiled personal-site preview.

Uses only built dist files. Blocks network requests, and does not use account
information, cookies, metrics, credentials or production endpoints.
"""
import argparse
import base64
import json
import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

VIEWPORTS = [(320, 568), (390, 700), (390, 844), (768, 900), (844, 320), (1440, 900)]


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
                                "status": "available", "latestActivityAt": events[0]["at"],
                                "latestActivityKind": events[0]["kind"], "recentActivity": events,
                            },
                        }
                        page.route("**/api/telemetry/public", lambda route: route.fulfill(
                            status=200, content_type="application/json",
                            body=json.dumps(public_fixture),
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
                        assert page.locator("[data-gpt-event-filter]").count() == 4
                        page.locator("#gpt-event-list .gpt-event-card").first.wait_for(state="visible")
                        assert page.locator("#gpt-event-list .gpt-event-card").count() == 3
                        assert page.locator(".gpt-live-panel").get_attribute("data-source-state") == "ready"
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
                browser = getattr(playwright, name).launch(**kwargs)
                try:
                    all_results.extend(
                        check(browser, name, html, css, script, axe_source, args.out, origin)
                    )
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
