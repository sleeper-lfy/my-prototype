#!/usr/bin/env python3
"""Real-browser acceptance of the local editor using an isolated on-disk project.

Requires Python 3.10+, playwright and Chromium. Example:
    python scripts/browser-smoke.py --chromium /usr/bin/chromium
All edits happen through the UI; API GETs only verify persisted state or fetch the
example patch. No working project in data/ is changed by this script.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import struct
import sys
import tempfile
import time
import traceback
from urllib.request import urlopen
import zipfile

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / "artifacts"
RESULT_FILE = ARTIFACTS / "browser-test-results.json"


def read_json(url):
    with urlopen(url, timeout=5) as response:
        return json.load(response)


def wait_until(operation, description, timeout=15):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            result = operation()
            if result:
                return result
        except Exception as error:
            last = error
        time.sleep(0.1)
    raise AssertionError(f"Timed out: {description}; last error: {last}")


def assert_true(value, message):
    if not value:
        raise AssertionError(message)


def node(project, node_id):
    return next(item for item in project["nodes"] if item["id"] == node_id)


def read_zip(path):
    with zipfile.ZipFile(path) as archive:
        assert_true(archive.testzip() is None, "ZIP integrity check failed")
        return {name: archive.read(name) for name in archive.namelist()}


def main():
    global ARTIFACTS, RESULT_FILE
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4381)
    parser.add_argument("--chromium", default=shutil.which("chromium") or shutil.which("google-chrome"))
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--skip-build", action="store_true", help="Use an already built production bundle")
    parser.add_argument("--development", action="store_true", help="Use Vite dev middleware instead of building and serving production")
    parser.add_argument("--out", type=Path, default=ARTIFACTS, help="Directory for this run; use a versioned path to retain earlier evidence")
    args = parser.parse_args()
    ARTIFACTS = args.out.resolve()
    RESULT_FILE = ARTIFACTS / "browser-test-results.json"
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    results = {
        "schemaVersion": 1,
        "runner": "Python Playwright / real Chromium UI interactions",
        "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "baseUrl": f"http://127.0.0.1:{args.port}",
        "isolatedData": True,
        "mode": "development" if args.development else "production",
        "checks": [],
        "status": "running",
    }
    base = results["baseUrl"]
    page = None
    browser = None
    server = None
    page_errors = []

    def check(name, operation):
        started = time.monotonic()
        try:
            details = operation()
            entry = {"name": name, "status": "passed", "seconds": round(time.monotonic() - started, 3)}
            if details is not None:
                entry["details"] = details
            results["checks"].append(entry)
            print(f"PASS {name}", flush=True)
            return details
        except Exception as error:
            results["checks"].append({"name": name, "status": "failed", "error": str(error)})
            raise

    def project():
        return read_json(f"{base}/api/project")

    def saved(predicate, description):
        def condition():
            current = project()
            return current if predicate(current) else None
        return wait_until(condition, description)

    try:
        if not args.development and not args.skip_build:
            def build():
                npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
                assert_true(npm is not None, "npm is required")
                built = subprocess.run([npm, "run", "build"], cwd=ROOT, capture_output=True, text=True, timeout=120)
                assert_true(built.returncode == 0, f"Production build failed: {built.stdout} {built.stderr}")
                return {"command": "npm run build", "exitCode": built.returncode}
            check("production bundle builds from current source", build)
        with tempfile.TemporaryDirectory(prefix="game-ui-studio-browser-") as temporary:
            temporary = Path(temporary)
            data_dir = temporary / "data"
            log_path = temporary / "server.log"
            with log_path.open("w", encoding="utf-8") as log:
                environment = dict(os.environ, STUDIO_DATA_DIR=str(data_dir), PORT=str(args.port))
                command = ["node", "server/index.js"] + ([] if args.development else ["--production"])
                server = subprocess.Popen(command, cwd=ROOT, env=environment, stdout=log, stderr=subprocess.STDOUT)
                check("isolated local server starts", lambda: wait_until(lambda: read_json(f"{base}/api/health")["ok"], "server startup", 35))
                assert_true(server.poll() is None, "Test server exited; chosen port may already be in use")
                with sync_playwright() as playwright:
                    options = {"headless": not args.headed, "args": ["--no-sandbox"]}
                    if args.chromium:
                        options["executable_path"] = args.chromium
                    browser = playwright.chromium.launch(**options)
                    results["browserVersion"] = browser.version
                    page = browser.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=1, accept_downloads=True)
                    page.on("pageerror", lambda error: page_errors.append(str(error)))
                    page.set_default_timeout(12000)
                    run_editor_checks(page, base, temporary, check, project, saved, results)
                    check("no uncaught browser errors", lambda: assert_true(not page_errors, f"Browser uncaught errors: {page_errors}"))
                    results["status"] = "passed"
                    browser.close()
                    browser = None
    except Exception as error:
        results["status"] = "failed"
        results["error"] = str(error)
        results["traceback"] = traceback.format_exc()
        if page is not None:
            try:
                page.screenshot(path=str(ARTIFACTS / "editor.png"), full_page=True)
            except Exception:
                pass
        print(results["traceback"], file=sys.stderr)
    finally:
        if browser:
            try:
                browser.close()
            except Exception:
                pass
        if server:
            server.terminate()
            try:
                server.wait(timeout=8)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
        results["pageErrors"] = page_errors
        results["completedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        results["passed"] = sum(item["status"] == "passed" for item in results["checks"])
        results["failed"] = sum(item["status"] == "failed" for item in results["checks"])
        RESULT_FILE.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Results: {RESULT_FILE}; status={results['status']}", flush=True)
    return 0 if results["status"] == "passed" else 1


def run_editor_checks(page, base, temporary, check, project, saved, results):
    """Concrete UI selectors are kept together to make changes reviewable."""
    original = project()
    results["sample"] = {"projectId": original["id"], "revision": original["revision"], "canvas": original["canvas"]}

    def layer(node_id):
        return page.locator(f'button[data-node-id="{node_id}"]')

    def download(button, filename):
        with page.expect_download() as event:
            button.click()
        target = temporary / filename
        event.value.save_as(target)
        return target

    def open_editor():
        response = page.goto(base, wait_until="networkidle")
        page.get_by_test_id("language-select").select_option("en")
        expect(page.locator("html")).to_have_attribute("lang", "en")
        assert_true(response.status == 200, "Editor did not load")
        expect(layer("recruit-button")).to_be_visible()
        expect(page.locator(".konvajs-content canvas").first).to_be_visible()
        page.evaluate("() => document.fonts.ready")
        assert_true(page.locator(".konvajs-content canvas").count() >= 2, "Expected real Konva art and overlay layers")
        return {"components": len(original["nodes"]), "reviews": len(original["reviews"])}
    check("editor loads real Konva scene", open_editor)

    def capture_original():
        target = download(page.get_by_role("button", name="Export canvas PNG", exact=True), "sample-canvas.png")
        raw = target.read_bytes()
        assert_true(raw[:8] == bytes([137,80,78,71,13,10,26,10]), "Canvas export is not PNG")
        size = struct.unpack(">II", raw[16:24])
        assert_true(size == (960, 600), f"Canvas must have native size, got {size}")
        (ARTIFACTS / "canvas.png").write_bytes(raw)
        page.screenshot(path=str(ARTIFACTS / "editor.png"), full_page=True)
        results["canvasScreenshot"] = {"path": str((ARTIFACTS / "canvas.png").relative_to(ROOT)), "width": size[0], "height": size[1], "projectId": original["id"], "revision": original["revision"], "selectionOverlays": False}
        return results["canvasScreenshot"]
    check("export original canvas PNG at native 960x600", capture_original)

    def select_component():
        layer("details-button").click()
        page.get_by_role("button", name="Properties", exact=True).click()
        expect(page.get_by_label("W", exact=True)).to_have_value(str(node(original, "details-button")["frame"]["width"]))
        expect(page.locator(".selection-heading code")).to_have_text("details-button")
        return {"nodeId": "details-button"}
    check("select stable-ID component through layer tree", select_component)

    before_drag = dict(node(project(), "details-button")["frame"])

    def drag_component():
        board = page.locator(".konvajs-content").bounding_box()
        zoom = board["width"] / original["canvas"]["width"]
        start_x = board["x"] + (before_drag["x"] + before_drag["width"] / 2) * zoom
        start_y = board["y"] + (before_drag["y"] + before_drag["height"] / 2) * zoom
        page.mouse.move(start_x, start_y)
        page.mouse.down()
        page.mouse.move(start_x - 16 * zoom, start_y - 24 * zoom, steps=10)
        page.mouse.up()
        after = saved(lambda p: node(p, "details-button")["frame"]["y"] != before_drag["y"], "real drag saves moved component")
        assert_true(node(after, "details-button")["id"] == "details-button", "Drag changed stable ID")
        return {"before": before_drag, "after": node(after, "details-button")["frame"], "input": "real mouse drag"}
    check("free component drag persists coordinates", drag_component)

    def resize_component():
        desired = before_drag["width"] + 16
        page.get_by_label("W", exact=True).fill(str(desired))
        page.get_by_label("W", exact=True).press("Tab")
        saved(lambda p: node(p, "details-button")["frame"]["width"] == desired, "width edit autosaves")
        page.get_by_role("button", name="Undo (Ctrl+Z)", exact=True).click()
        saved(lambda p: node(p, "details-button")["frame"]["width"] == before_drag["width"], "undo width edit")
        page.get_by_role("button", name="Redo (Ctrl+Shift+Z)", exact=True).click()
        saved(lambda p: node(p, "details-button")["frame"]["width"] == desired, "redo width edit")
        return {"width": desired, "undo": "passed", "redo": "passed"}
    check("dimension edit, undo and redo persist", resize_component)

    def lock_component():
        page.get_by_role("button", name="Toggle selected lock", exact=True).click()
        saved(lambda p: node(p, "details-button").get("locked") is True, "component locked")
        expect(page.get_by_label("W", exact=True)).to_be_disabled()
        page.get_by_role("button", name="Toggle selected lock", exact=True).click()
        saved(lambda p: node(p, "details-button").get("locked") is False, "component unlocked")
        expect(page.get_by_label("W", exact=True)).to_be_enabled()
    check("component lock disables size editing", lock_component)

    review_target = "Browser acceptance: portrait border"
    review_expected = "Increase the card border contrast; preserve its portrait and component ID."
    review_id = None

    def add_review():
        nonlocal review_id
        layer("character-card").click()
        page.get_by_role("button", name="Review", exact=False).filter(has_text="Review").first.click()
        page.get_by_label("Review target", exact=True).fill(review_target)
        page.get_by_label("Expected result", exact=True).fill(review_expected)
        page.get_by_label("Protected properties", exact=True).fill("frame.width, frame.height, style.fill")
        page.get_by_label("Review priority", exact=True).select_option("high")
        page.get_by_role("button", name="Add feedback", exact=True).click()
        value = saved(lambda p: any(r["target"] == review_target for r in p["reviews"]), "new review saved")
        review = next(r for r in value["reviews"] if r["target"] == review_target)
        review_id = review["id"]
        assert_true(review["nodeId"] == "character-card" and review["status"] == "pending", "Review is not attached to selected stable ID")
        assert_true(review["protectedProperties"] == ["frame.width", "frame.height", "style.fill"], "Review protections were not saved")
        # Move the commented component after attaching the review, then reload.
        card_x = node(value, "character-card")["frame"]["x"]
        page.get_by_role("button", name="Properties", exact=True).click()
        page.get_by_label("X", exact=True).fill(str(card_x + 8))
        page.get_by_label("X", exact=True).press("Tab")
        saved(lambda p: node(p, "character-card")["frame"]["x"] == card_x + 8, "commented card moves while preserving review ID")
        page.reload(wait_until="networkidle")
        expect(page.get_by_text(review_target, exact=True)).to_be_visible()
        value = project()
        assert_true(next(r for r in value["reviews"] if r["id"] == review_id)["nodeId"] == "character-card", "Review association lost after reload")
        assert_true(node(value, "details-button")["frame"] != before_drag, "Saved edits lost after reload")
        return {"reviewId": review_id, "nodeId": "character-card", "survivesMove": True, "survivesReload": True}
    check("component review saves and survives browser reload", add_review)

    def export_feedback():
        feedback_project = project()
        target = download(page.get_by_test_id("export-feedback"), "feedback.zip")
        files = read_zip(target)
        (ARTIFACTS / "feedback-sample.zip").write_bytes(target.read_bytes())
        feedback = json.loads(files["feedback.json"])
        assert_true(all(r["status"] == "pending" for r in feedback["reviews"]), "Feedback contains non-pending reviews")
        assert_true(review_id in [r["id"] for r in feedback["reviews"]], "New review omitted")
        assert_true(feedback["baseRevision"] == feedback_project["revision"] == project()["revision"], "Feedback revision stale")
        (ARTIFACTS / "feedback-project.json").write_text(json.dumps(feedback_project, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        assert_true("patch-template.json" in files and "PATCH-INSTRUCTIONS.md" in files, "Patch instructions missing")
        assert_true(feedback.get("tokens") and isinstance(feedback.get("context"), list) and feedback.get("canvas"), "Design rules or context envelope missing")
        for selected_id in {r["nodeId"] for r in feedback["reviews"]}:
            png = files[feedback["screenshots"][selected_id]]
            assert_true(png.startswith(bytes([137,80,78,71,13,10,26,10])), f"No screenshot for {selected_id}")
            width, height = struct.unpack(">II", png[16:24])
            assert_true(0 < width <= 960 and 0 < height <= 600, "Invalid screenshot crop")
        return {"pendingReviewCount": len(feedback["reviews"]), "screenshots": list(feedback["screenshots"]), "baseRevision": feedback["baseRevision"], "zipEntries": len(files)}
    check("feedback export contains pending reviews, restrictions and local PNGs", export_feedback)

    before_patch = project()
    expected_text = "RECRUIT · 240"

    def import_patch():
        patch = read_json(f"{base}/api/example-patch")
        patch_path = temporary / "recruit.patch.json"
        patch_path.write_text(json.dumps(patch, ensure_ascii=False), encoding="utf-8")
        (ARTIFACTS / "applied.patch.json").write_text(json.dumps(patch, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        # This is a file input interaction, not an API mutation.
        page.get_by_test_id("patch-file").set_input_files(patch_path)
        expect(page.get_by_role("dialog", name="Review patch")).to_be_visible()
        assert_true(json.loads(page.get_by_label("Patch JSON").input_value())["baseRevision"] == before_patch["revision"], "Import preview revision differs")
        page.get_by_test_id("preview-ui-patch").click()
        page.get_by_test_id("apply-ui-patch").click()
        value = saved(lambda p: node(p, "recruit-button")["style"]["text"] == expected_text, "patch applied through UI")
        expect(page.locator(".diff-row ins").filter(has_text=expected_text)).to_be_visible()
        expect(page.locator(".diff-row del").filter(has_text=node(before_patch, "recruit-button")["style"]["text"])).to_be_visible()
        assert_true(len(value["nodes"]) == len(before_patch["nodes"]), "Patch rebuilt component tree")
        assert_true(next(r for r in value["reviews"] if r["id"] == "review-cta")["status"] == "modified", "Patch did not mark review modified")
        assert_true(node(value, "recruit-button")["frame"] == node(before_patch, "recruit-button")["frame"], "Patch modified protected frame")
        history = value["history"][-1]
        (ARTIFACTS / "after-patch.project.json").write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        # Reload from disk before accepting that the patch's diff is durable.
        page.reload(wait_until="networkidle")
        expect(page.get_by_label("Review status review-cta", exact=True)).to_have_value("modified")
        page.get_by_role("button", name="Changes", exact=True).click()
        expect(page.locator(".diff-row ins").filter(has_text=expected_text)).to_be_visible()
        expect(page.locator(".diff-row del").filter(has_text=node(before_patch, "recruit-button")["style"]["text"])).to_be_visible()
        assert_true(any(entry["id"] == history["id"] for entry in project()["history"]), "Patch history disappeared after reload")
        page.screenshot(path=str(ARTIFACTS / "patch-diff.png"), full_page=True)
        page.screenshot(path=str(ARTIFACTS / "editor.png"), full_page=True)
        return {"historyId": history["id"], "changes": history["changes"], "reviewStatus": "modified", "diffAndStatusSurviveReload": True}
    check("import local patch, apply incrementally and display exact diff", import_patch)

    def rollback_patch():
        page.get_by_role("button", name="Safely roll back this change", exact=True).click()
        value = saved(lambda p: node(p, "recruit-button")["style"]["text"] == node(before_patch, "recruit-button")["style"]["text"], "safe rollback restores text")
        assert_true(next(r for r in value["reviews"] if r["id"] == "review-cta")["status"] == "pending", "Rollback did not restore review status")
        assert_true(node(value, "details-button")["frame"] == node(before_patch, "details-button")["frame"], "Rollback overwrote unrelated edits")
        expect(page.get_by_role("button", name="Rolled back", exact=True)).to_be_disabled()
        return {"restoredText": node(value, "recruit-button")["style"]["text"], "unrelatedEditsPreserved": True}
    check("safe rollback restores reviewed change and preserves unrelated edits", rollback_patch)

    def export_godot():
        target = download(page.get_by_role("button", name="Export Godot project", exact=True), "godot.zip")
        files = read_zip(target)
        for filename in ["project.godot", "main.tscn", "capture.gd", "node-map.json"]:
            assert_true(filename in files, f"Godot export missing {filename}")
        scene = files["main.tscn"].decode("utf-8")
        assert_true("studio_id" in scene and "recruit-button" in scene, "Stable ID metadata missing from exported scene")
        assert_true(any(name.startswith("assets/") for name in files), "Godot export has no assets")
        return {"zipEntries": len(files), "componentIdMapping": True, "runtimeValidation": "Separate scripts/test-godot.js must run real Godot; ZIP inspection alone is not runtime validation."}
    check("Godot project downloads through UI with native scene, assets and ID map", export_godot)

    def container_layout():
        layer("stat-vitality").click()
        page.get_by_role("button", name="Properties", exact=True).click()
        expect(page.get_by_label("X", exact=True)).to_be_disabled()
        expect(page.get_by_label("Y", exact=True)).to_be_disabled()
        expect(page.get_by_label("W", exact=True)).to_be_enabled()
        expect(page.get_by_text("The parent container controls positioning. Move the component to the canvas or a free group to drag it freely.", exact=True)).to_be_visible()
        return {"nodeId": "stat-vitality", "parentId": "stats-row", "positionInputs": "disabled", "sizeInputs": "enabled"}
    check("Container children explain and enforce automatic position", container_layout)

    def native_component_template():
        baseline = project()
        before_ids = {item["id"] for item in baseline["nodes"]}
        page.get_by_label("New component type", exact=True).select_option("Button")
        page.get_by_role("button", name="Add component", exact=True).click()
        value = saved(lambda p: len(p["nodes"]) == len(before_ids) + 1, "native Button creation")
        created = next(item for item in value["nodes"] if item["id"] not in before_ids)
        assert_true(created["type"] == "Button" and not created.get("assetId"), "Created component is not a native editable Button")
        page.get_by_label("Component text", exact=True).fill("TEST ACTION")
        page.get_by_label("Component text", exact=True).press("Tab")
        saved(lambda p: node(p, created["id"])["style"]["text"] == "TEST ACTION", "native Button text edit")
        page.get_by_role("button", name="Duplicate (Ctrl+D)", exact=True).click()
        value = saved(lambda p: len(p["nodes"]) == len(before_ids) + 2, "Button duplication")
        duplicate = next(item for item in value["nodes"] if item["id"] not in before_ids | {created["id"]})
        layer(created["id"]).click(modifiers=["Shift"])
        page.get_by_role("button", name="Group selection", exact=True).click()
        value = saved(lambda p: len(p["nodes"]) == len(before_ids) + 3, "multi-select grouping")
        group = next(item for item in value["nodes"] if item["id"] not in before_ids | {created["id"], duplicate["id"]})
        assert_true(group["type"] == "Control", "Group is not a free-layout Control")
        assert_true(node(value, created["id"])["parentId"] == node(value, duplicate["id"])["parentId"] == group["id"], "Group did not preserve child structure")
        target = download(page.get_by_role("button", name="Export component", exact=True), "selection.component.json")
        template = json.loads(target.read_text(encoding="utf-8"))
        assert_true(template["kind"] == "studio-component" and len(template["nodes"]) == 3, "Template did not include grouped subtree")
        template_ids = {item["id"] for item in template["nodes"]}
        before_import_ids = {item["id"] for item in value["nodes"]}
        page.get_by_test_id("component-file").set_input_files(target)
        value = saved(lambda p: len(p["nodes"]) == len(before_import_ids) + 3, "template file import")
        inserted = [item for item in value["nodes"] if item["id"] not in before_import_ids]
        assert_true(len({item["id"] for item in inserted}) == 3 and not template_ids.intersection(item["id"] for item in inserted), "Imported template reused stable IDs")
        inserted_root = next(item for item in inserted if item["parentId"] is None)
        assert_true(all(item["parentId"] == inserted_root["id"] for item in inserted if item["id"] != inserted_root["id"]), "Imported template lost hierarchy")
        assert_true(all(item["style"]["text"] == "TEST ACTION" for item in inserted if item["type"] == "Button"), "Imported native labels changed")
        return {"createdType": "Button", "editableText": "TEST ACTION", "groupType": "Control", "templateNodes": 3, "importedFreshIds": [item["id"] for item in inserted]}
    check("create native Button, edit, duplicate, group and round-trip component template", native_component_template)



if __name__ == "__main__":
    raise SystemExit(main())
