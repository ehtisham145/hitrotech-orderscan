import asyncio
import os
import json
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        
        # Inject auth if available
        storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
        session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
        
        page = await context.new_page()
        await page.goto("http://localhost:8080")
        
        if storage_key and session_json:
            await page.evaluate(f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})")
            await page.goto("http://localhost:8080/batches")
            print("Navigated to batches page with auth")
        else:
            print("No auth session found, checking public visibility")

        await page.wait_for_timeout(2000)
        await page.screenshot(path="/tmp/browser/batches_check.png")
        
        # Check for any "Processing" status in the DOM
        content = await page.content()
        if "Processing" in content:
            print("Found 'Processing' status in UI")
        else:
            print("No active processing found in UI")
            
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
