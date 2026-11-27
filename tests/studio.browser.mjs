// Full UI fixture: no request may leave the loopback host.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import {createStudioServer} from '../server/studio-server.mjs';

const app=createStudioServer();
const origin=await app.start(0);
let browser;
const external=[], pageErrors=[], methods=[];
try {
  browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH,args:['--no-sandbox','--disable-background-networking']});
  const page=await browser.newPage();
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request',request=>{
    const url=new URL(request.url());
    if (['data:','blob:'].includes(url.protocol) || url.origin===origin) {
      if(url.pathname.startsWith('/api/studio/operations')) methods.push(request.method());
      return void request.continue();
    }
    external.push(url.origin); void request.abort();
  });
  await page.goto(origin);
  await page.waitForFunction(()=>document.querySelector('#api-status').textContent.includes('零额度'));
  assert.equal(await page.$eval('#apikey-modal',x=>x.classList.contains('open')),false);
  assert.equal(await page.evaluate(()=>localStorage.getItem('minimax_api_key')),null);
  const cases=[
    ['chat','messages','pre'],
    ['image','prompt','.image-card img'],
    ['video','prompt','video'],
    ['speech','text','.audio-player'],
    ['music','prompt','.audio-player']
  ];
  for(const [name,field,result] of cases) {
    await page.click(`[data-model="${name}"]`);
    await page.type(`[data-key="${field}"]`,'synthetic fixture');
    await page.click('#generate-btn');
    await page.waitForSelector('#result-content '+result,{visible:true,timeout:2500}).catch(async error => { console.error(name,methods,pageErrors,await page.evaluate(()=>({result:document.querySelector('#result-content').innerText,status:document.querySelector('#api-status').innerText,toast:document.querySelector('#toast-container').innerText,active:document.querySelector('.nav-item.active')?.dataset.model}))); throw error; });
    await page.waitForFunction(()=>!document.querySelector('#generate-btn').disabled);
  }
  assert.equal(methods.filter(x=>x==='POST').length,cases.length);

  // Reopen the same result after page reload; downloads remain byte-correct.
  await page.reload();
  await page.waitForSelector('#studio-resume',{visible:true});
  await page.click('#studio-resume');
  await page.waitForSelector('.audio-player');
  const content=await page.$eval('.audio-download',async a=>{
    const response=await fetch(a.href);
    const bytes=new Uint8Array(await response.arrayBuffer());
    return {status:response.status,magic:String.fromCharCode(...bytes.slice(0,4)),download:a.hasAttribute('download')};
  });
  assert.deepEqual(content,{status:200,magic:'RIFF',download:true});
  assert.equal(methods.filter(x=>x==='POST').length,cases.length);
  assert.deepEqual(pageErrors,[]);
  assert.deepEqual(external,[]);
  console.log('PASS: default localhost studio, five multimodal UI actions, reload and byte-checked download, no external traffic');
} finally { await browser?.close(); await app.close(); }
