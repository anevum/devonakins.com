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
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import sync_playwright

VIEWPORTS = [(320, 568), (390, 844), (768, 900), (844, 320), (1440, 768), (1440, 900)]


def compiled_preview(dist: Path):
    html = (dist / "v2/index.html").read_text(encoding="utf-8")
    css = (dist / "v2/terminal.css").read_text(encoding="utf-8")
    scripts = re.findall(r'<script type="module"[^>]+src="(/assets/[^"]+\.js)"[^>]*></script>', html)
    if len(scripts) != 1:
        raise AssertionError(f"Expected one V2 client entrypoint, got {scripts}")
    script = (dist / scripts[0].lstrip("/")).read_text(encoding="utf-8")
    # The generated modulepreload polyfill is unrelated to these controls.
    script, count = re.subn(r'^import"\./modulepreload-polyfill-[^"]+";', "", script)
    if count != 1:
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
            assert page.locator(".portrait-figure").evaluate(
                "el => el.complete && el.naturalWidth > 0"
            ), "portrait failed to decode"
            assert page.locator("#motion-toggle").is_disabled(), "reduced motion ignored"
            # Public stats are an owner-reported dated snapshot, not a live API or follower total.
            if origin:
                try:
                    page.wait_for_function(
                        'document.querySelector("#usage-value").textContent.includes("2.6B")'
                    )
                except Exception as error:
                    diagnostic = page.evaluate("""async () => {
                      let details = {};
                      try {
                        const response = await fetch('/v2/usage-snapshot.json', {cache:'no-store'});
                        details = {http:response.status, type:response.headers.get('content-type'), text:(await response.text()).slice(0,350)};
                      } catch (e) { details = {fetchError:String(e)}; }
                      return {
                        value:document.querySelector('#usage-value')?.textContent,
                        status:document.querySelector('#usage-status')?.textContent,
                        date:document.querySelector('#usage-date')?.textContent,
                        details
                      };
                    }""")
                    raise AssertionError(f"Snapshot unavailable in compiled {label}: {diagnostic}") from error
                assert page.locator("#usage-value").inner_text() == "≈2.6B"
                assert "Not live" in page.locator("#usage-status").inner_text()
                assert "Nov 2, 2026" in page.locator("#usage-date").inner_text()
                assert "Work and Codex tokens" in (
                    page.locator("#usage-value").get_attribute("aria-label") or ""
                )
                if width == 390:
                    # Network outage / invalid load must never leave a stale public number.
                    page.route("**/v2/usage-snapshot.json", lambda route: route.abort())
                    page.locator("#refresh-usage").click()
                    page.wait_for_function(
                        'document.querySelector("#usage-value").textContent === "—"'
                    )
                    assert "No verified public snapshot" in page.locator("#usage-status").inner_text()
                    page.unroute("**/v2/usage-snapshot.json")
                    page.locator("#refresh-usage").click()
                    page.wait_for_function(
                        'document.querySelector("#usage-value").textContent.includes("2.6B")'
                    )
            else:
                page.wait_for_function(
                    'document.querySelector("#usage-status").textContent.includes("No verified public snapshot")'
                )
                assert page.locator("#usage-value").inner_text() == "—"

            # A public GitHub REST response is simulated at the first-party Worker
            # path. No Playwright test connects to an external provider.
            if origin:
                updated_at = datetime.now(timezone.utc).isoformat(
                    timespec="milliseconds"
                ).replace("+00:00", "Z")
                github_payload = {
                    "version": 2, "account": "anevum",
                    "metric": "public-repositories", "count": 12,
                    "asOf": updated_at, "source": "GitHub REST API",
                    "attestation": "public-provider-response",
                    "recent": {
                        "name": "devonakins.com",
                        "pushedAt": updated_at,
                        "url": "https://github.com/anevum/devonakins.com",
                    },
                }
                github_pattern = "**/v2/github-profile.json"
                github_route = lambda route: route.fulfill(
                    status=200, content_type="application/json",
                    body=json.dumps(github_payload)
                )
                page.route(github_pattern, github_route)
                page.locator('[data-signal="github"]').click()
                page.wait_for_function(
                    'document.querySelector("#usage-value").textContent === "12"'
                )
                assert page.locator('[data-signal="github"]').get_attribute("aria-pressed") == "true"
                assert page.locator('[data-signal="chatgpt"]').get_attribute("aria-pressed") == "false"
                assert "Cached" in page.locator("#usage-status").inner_text()
                assert "public repositories" in (
                    page.locator("#usage-value").get_attribute("aria-label") or ""
                )
                assert page.locator("#signal-link").get_attribute("href") == "https://github.com/anevum"
                if width == 390:
                    page.unroute(github_pattern, github_route)
                    failure_route = lambda route: route.fulfill(
                        status=503, content_type="application/json",
                        body='{"error":"github_public_signal_unavailable"}'
                    )
                    page.route(github_pattern, failure_route)
                    page.locator("#refresh-usage").click()
                    page.wait_for_function(
                        'document.querySelector("#usage-value").textContent === "—"'
                    )
                    assert "unavailable" in page.locator("#usage-status").inner_text()
                    page.unroute(github_pattern, failure_route)
                    page.route(github_pattern, github_route)
                    page.locator("#refresh-usage").click()
                    page.wait_for_function(
                        'document.querySelector("#usage-value").textContent === "12"'
                    )
                page.locator('[data-signal="chatgpt"]').click()
                page.wait_for_function(
                    'document.querySelector("#usage-value").textContent.includes("2.6B")'
                )
                assert page.locator('[data-signal="chatgpt"]').get_attribute("aria-pressed") == "true"
                # Keep the route active until the Work panel consumes the same
                # owner-scoped, first-party public project signal.

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

            check_overflow("home")
            mobile = width <= 960
            light = page.locator("#mobile-light" if mobile else "#shift-light")
            assert light.is_visible(), "portrait lighting control missing"
            if mobile:
                bounds = light.bounding_box()
                assert bounds and bounds["width"] >= 44 and bounds["height"] >= 44, bounds
            if not mobile:
                light_bounds = light.bounding_box()
                footer_bounds = page.locator(".statusbar").bounding_box()
                assert light_bounds and footer_bounds
                assert light_bounds["y"] + light_bounds["height"] <= footer_bounds["y"], (
                    "Observatory lighting must not be overlapped by footer",
                    light_bounds, footer_bounds
                )
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
            if origin:
                page.wait_for_function(
                    'document.querySelector("#recent-code-name").textContent === "devonakins.com"'
                )
                assert page.locator("#recent-code-link").get_attribute("href") == "https://github.com/anevum/devonakins.com"
                assert "Last pushed" in page.locator("#recent-code-status").inner_text()
                assert "not a release" in page.locator("#recent-code-status").inner_text()
                assert page.locator("#recent-code-link").is_visible()
                page.unroute(github_pattern, github_route)
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
