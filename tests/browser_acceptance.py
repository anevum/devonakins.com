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

VIEWPORTS = [(320, 568), (390, 844), (768, 900), (844, 320), (1440, 900)]


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
            if origin:
                page.wait_for_function("""() => {
                    const value = document.querySelector('#home-usage-value');
                    const status = document.querySelector('#usage-status');
                    return value?.textContent?.trim() === '≈2.6B' &&
                        status?.textContent?.includes('Not live tracking.');
                }""")
                assert page.locator("#home-usage-date").inner_text().startswith(
                    "AS OF 2026-11-02"
                ), "dated activity snapshot missing"
                if (width, height) == (390, 844):
                    # Falsification: a malformed owner snapshot must clear BOTH
                    # the sidebar and the prominent hero, then recover on refresh.
                    snapshot_url = "**/v2/usage-snapshot.json"
                    page.route(snapshot_url, lambda route: route.fulfill(
                        status=200, content_type="application/json",
                        body='{"version":1,"count":-1}'
                    ))
                    page.locator("#refresh-usage").click()
                    page.wait_for_function("""() => {
                        return document.querySelector('#home-usage-value')?.textContent?.trim() === '—' &&
                          document.querySelector('#usage-value')?.textContent?.trim() === '—' &&
                          document.querySelector('#home-usage-date')?.textContent?.includes('NO VERIFIED PUBLIC SNAPSHOT');
                    }""")
                    page.unroute(snapshot_url)
                    page.locator("#refresh-usage").click()
                    page.wait_for_function("""() =>
                      document.querySelector('#home-usage-value')?.textContent?.trim() === '≈2.6B' &&
                      document.querySelector('#usage-value')?.textContent?.trim() === '≈2.6B'
                    """)
            else:
                assert page.locator("#home-usage-value").inner_text().strip() == "—"
                assert "SNAPSHOT" in page.locator("#home-usage-date").inner_text()
            if (width, height) in [(390, 844), (1440, 900)]:
                assert page.locator("#home-usage-value").evaluate("""el => {
                  const box = el.getBoundingClientRect();
                  return box.width > 0 && box.height > 0 &&
                    box.top >= 0 && box.bottom <= innerHeight;
                }"""), "home activity metric not in the initial viewport"
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

            # The first screen must preserve both owner-requested public signals.
            featured = page.locator(".hero-feature")
            usage = page.locator(".hero-usage")
            assert featured.is_visible(), "AIEI/ISL highlights not visible"
            assert usage.is_visible(), "dated ChatGPT activity not visible"
            assert page.locator(".hero-feature-link").count() == 2
            assert page.locator(".hero-feature-link").nth(0).get_attribute("href") == "/work/aiei/"
            assert page.locator(".hero-feature-link").nth(1).get_attribute("href") == "/work/isl/"
            if origin:
                # The module loads a first-party JSON snapshot asynchronously.
                # Wait for validated data, not merely page load, on both engines.
                page.wait_for_function(
                    """() => document.querySelector('#home-usage-value')?.textContent?.trim() === '≈2.6B'""",
                    timeout=7000,
                )
                assert "≈2.6B" in page.locator("#home-usage-value").inner_text()
                assert "OWNER-REPORTED" in page.locator("#home-usage-date").inner_text()
                assert "NOT LIVE" in page.locator("#home-usage-date").inner_text()
            else:
                assert page.locator("#home-usage-value").inner_text().strip() == "—"
                assert "SNAPSHOT" in page.locator("#home-usage-date").inner_text()
            check_overflow("home")
            # On normal portrait-phone and desktop viewports the featured project
            # cards must be in the initial panel viewport, not clipped below it.
            if (width, height) in [(390, 844), (1440, 900)]:
                feature_box = featured.bounding_box()
                panel_box = page.locator("#panel-home").bounding_box()
                assert feature_box and panel_box
                assert feature_box["y"] >= panel_box["y"], (label, feature_box, panel_box)
                assert (feature_box["y"] + feature_box["height"]
                        <= panel_box["y"] + panel_box["height"] - 8), (
                    label, "Featured AIEI/ISL cards are below the fold", feature_box, panel_box
                )
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
                assert page.locator(".hero-feature").is_visible(), "canonical AIEI/ISL missing"
                assert page.locator(".hero-usage").is_visible(), "canonical GPT activity missing"
                page.wait_for_function(
                    """() => document.querySelector('#home-usage-value')?.textContent?.trim() === '≈2.6B'""",
                    timeout=7000,
                )
                assert page.locator("#home-usage-value").inner_text() == "≈2.6B"
                page.wait_for_function("""() => {
                    const text = document.querySelector('#usage-status')?.textContent ?? '';
                    return text.includes('Owner-reported estimate');
                }""", timeout=7000)
                assert "NOT LIVE" in page.locator("#home-usage-date").inner_text()
                report = page.request.get(origin + "/v2/usage-snapshot.json")
                assert report.status == 200, "snapshot endpoint failed"
                assert "application/json" in report.headers.get("content-type", "")
                assert report.json()["count"] == 2600000000
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

            if origin and (width, height) == (390, 844):
                # All legacy deep links must render the cinematic shell,
                # retain their own content, and return via the canonical tabs.
                for route in [
                    "/work/", "/source/", "/about/", "/contact/",
                    "/work/operations/", "/work/writing/", "/work/anevum/",
                    "/work/ideaflow/", "/work/devonstation/",
                    "/work/aiei/", "/work/isl/", "/work/phatcake/",
                    "/work/brandicade/", "/work/rhen/",
                ]:
                    response = page.goto(origin + route, wait_until="load")
                    assert response and response.status == 200, route
                    assert page.locator("#interface-shell").get_attribute("data-route-page") == "true", route
                    assert page.locator(".route-content").is_visible(), route
                    assert page.locator(".portrait-figure").evaluate(
                        "el => el.complete && el.naturalWidth > 0"
                    ), "portrait decode: " + route
                    assert not page.locator(".site-header").count(), route
                    check_overflow("deep link " + route)
                    if axe_source and route in ["/work/", "/work/ideaflow/", "/work/aiei/", "/work/isl/", "/contact/"]:
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
