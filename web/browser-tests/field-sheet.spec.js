import { test, expect } from '@playwright/test';

test('field sheet prints safely without a popup or changing editor state', async ({ page }) => {
  await page.goto('/privacy.html');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const result = await page.evaluate(async () => {
    const { defaultDocument } = await import('/src/plotDocument.js');
    const { printFieldSheet } = await import('/src/fieldSheet.js');
    const doc = defaultDocument();
    doc.name = 'Pool <north>';
    doc.points = [{ id: 'p', label: '12', description: 'Corner & steps', needsRemeasure: true, note: 'Check B\nUse long tape', position: { x: 200, y: 300 } }];
    const original = JSON.stringify(doc);
    let printed = false, text = '', style = '';
    window.open = () => { throw new Error('Printing must not require a popup'); };
    const observer = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.tagName !== 'IFRAME') continue;
        node.contentWindow.print = () => {
          printed = true;
          text = node.contentDocument.body.innerText;
          style = node.contentWindow.getComputedStyle(node.contentDocument.querySelector('table')).tableLayout;
          node.contentWindow.dispatchEvent(new Event('afterprint'));
        };
      }
    });
    observer.observe(document.body, { childList: true });
    await printFieldSheet(doc);
    observer.disconnect();
    return { printed, text, style, unchanged: original === JSON.stringify(doc), frames: document.querySelectorAll('iframe').length };
  });
  expect(result.printed).toBe(true);
  expect(result.text).toContain('Pool <north>');
  expect(result.text).toContain('Corner & steps');
  expect(result.text).toContain('Check B\nUse long tape');
  expect(result.style).toBe('fixed');
  expect(result.unchanged).toBe(true);
  expect(result.frames).toBe(0);
  expect(errors).toEqual([]);
});
