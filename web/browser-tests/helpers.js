export async function seedBaseline(page) {
  await page.addInitScript(() => { if (!localStorage.getItem('abplot.web.document.v1')) localStorage.setItem('abplot.web.document.v1', JSON.stringify({name:'',pointA:{x:100,y:400},pointB:{x:300,y:400},abDistance:2,unit:'meters',points:[]})); });
}
export async function showPoints(page) { await page.locator('#panel-points').click(); await page.locator('#coordinate-table').evaluate(el=>{el.open=true;}); }
export async function addPoint(page) {
  await page.locator('#panel-measure').click(); await page.locator('#quick-a').fill('2'); await page.locator('#quick-b').fill('2'); await page.locator('#quick-save').click(); await showPoints(page);
}
