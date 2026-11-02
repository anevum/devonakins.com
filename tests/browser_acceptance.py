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
                # Exercise the canonical public homepage as well as the preview.
                root_response = page.goto(origin + "/", wait_until="load")
                assert root_response and root_response.status == 200
                root_html = page.content()
                assert 'rel="canonical" href="https://devonakins.com/"' in root_html
                assert 'name="robots" content="noindex' not in root_html
                assert "V2 PREVIEW" not in root_html
                page.locator("#panel-home").wait_for(state="visible")
                assert page.locator(".portrait-figure").evaluate(
                    "el => el.complete && el.naturalWidth > 0"
                ), "public homepage portrait failed to decode"
                check_overflow("published-home")
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
