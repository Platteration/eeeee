import { seedBaseline } from './helpers.js';
import { test, expect } from '@playwright/test';
async function setup(page, positions = [[200,300]]) {
  await seedBaseline(page); await page.goto('/');await expect(page.locator('#startup')).toBeHidden();
  return page.evaluate(positions=>{
    const points=positions.map(([x,y],i)=>({id:crypto.randomUUID().toUpperCase(),label:String(i+1),position:{x,y}}));
    window.abplot.store.apply(doc=>{doc.points=points;});window.abplot.editor.fit();return points.map(p=>p.id);
  },positions);
}
async function select(page,id) {
  await page.locator('#panel-points').click(); await page.locator('#review-details').evaluate(el=>{el.open=true;});
  await page.locator('#review-point').selectOption(id);
}

test('flagged point notes survive reload and impossible remeasurement cannot move it',async({page})=>{
  const [id]=await setup(page);await select(page,id);
  await page.locator('#review-flag').check();await page.locator('#review-note').fill('Check B near the steps');
  await page.locator('#remeasure-a').fill('0.1');await page.locator('#remeasure-b').fill('0.1');
  await expect(page.locator('#remeasure-status')).toContainText('Impossible triangle');await expect(page.locator('#remeasure-save')).toBeDisabled();
  expect(await page.evaluate(()=>window.abplot.store.document.points[0].position)).toEqual({x:200,y:300});
  await page.evaluate(()=>window.abplot.store.whenSaved());await page.reload();await expect(page.locator('#startup')).toBeHidden();await select(page,id);
  await expect(page.locator('#review-note')).toHaveValue('Check B near the steps');await expect(page.locator('#review-flag')).toBeChecked();
  await page.locator('#remeasure-a').fill('2');await page.locator('#remeasure-b').fill('2');await page.locator('#remeasure-save').click();
  await expect(page.locator('#review-flag')).not.toBeChecked();
  const point=await page.evaluate(()=>window.abplot.store.document.points[0]);expect(point.id).toBe(id);expect(point.note).toBe('Check B near the steps');expect(point.position.y).toBeCloseTo(400-Math.sqrt(3)*100);
  await page.locator('#undo').click();expect(await page.evaluate(()=>window.abplot.store.document.points[0].needsRemeasure)).toBe(true);
});

test('crossed order can be corrected and reversed without changing point coordinates',async({page})=>{
  const ids=await setup(page,[[100,200],[300,400],[100,400],[300,200]]);
  await expect(page.locator('#outline-warnings')).toContainText('cross or touch');
  await page.locator('#panel-checks').click(); await page.locator('#outline-warnings').getByRole('button',{name:'Check 3',exact:true}).first().click();
  const before=await page.evaluate(()=>Object.fromEntries(window.abplot.store.document.points.map(p=>[p.id,p.position])));
  await page.locator('#review-earlier').click();await expect(page.locator('#outline-warnings')).toBeEmpty();
  expect(await page.evaluate(()=>window.abplot.store.document.points.map(p=>p.id))).toEqual([ids[0],ids[2],ids[1],ids[3]]);
  await page.locator('#panel-checks').click(); await page.locator('#outline-direction').selectOption('clockwise');await expect(page.locator('#outline-warnings')).toContainText('counterclockwise');
  await page.locator('#outline-reverse').click();await expect(page.locator('#outline-warnings')).toBeEmpty();
  expect(await page.evaluate(()=>Object.fromEntries(window.abplot.store.document.points.map(p=>[p.id,p.position])))).toEqual(before);
});

test('clicking A opens baseline review and reference reminders persist',async({page})=>{
  await setup(page);
  await page.locator('#canvas [data-handle="A"]').click();
  await expect(page.locator('#review-details')).toHaveAttribute('open','');await expect(page.locator('#review-point')).toHaveValue('baseline');
  await page.locator('#review-flag').check();await page.locator('#review-note').fill('Check A–B tape sag');
  await page.evaluate(()=>window.abplot.store.whenSaved());await page.reload();await expect(page.locator('#startup')).toBeHidden();
  await page.locator('#panel-points').click(); await page.locator('#review-details').evaluate(el=>{el.open=true;});await expect(page.locator('#review-note')).toHaveValue('Check A–B tape sag');
  await expect(page.locator('#review-flag')).toBeChecked();
});

test('changing units during a remeasurement requires refreshing its fields',async({page})=>{
  const [id]=await setup(page);await select(page,id);await page.locator('#remeasure-a').fill('3');
  await page.locator('#panel-measure').click(); await page.locator('#unit').selectOption('feet'); await page.locator('#panel-points').click();await expect(page.locator('#remeasure-status')).toContainText('changed while you were typing');await expect(page.locator('#remeasure-save')).toBeDisabled();
  await page.locator('#remeasure-reset').click();await expect(page.locator('#remeasure-status')).toContainText('feet');
});
