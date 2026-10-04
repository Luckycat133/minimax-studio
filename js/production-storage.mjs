/** Browser-local binary storage. No network or credentials. */
export class AudioStore {
  constructor(indexedDB = globalThis.indexedDB) { this.indexedDB = indexedDB; this.db = null; }
  async open() {
    if (this.db) return this.db;
    if (!this.indexedDB) throw new Error('浏览器音频存储不可用；音频仅在本页内存中，请导出工作包');
    this.db = await new Promise((resolve,reject)=>{
      const request=this.indexedDB.open('minimax_dialogue_audio_v2',1);
      request.onupgradeneeded=()=>{ if(!request.result.objectStoreNames.contains('audio')) request.result.createObjectStore('audio'); };
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('无法打开浏览器音频库'));
      request.onblocked=()=>reject(new Error('音频库被另一个标签页阻塞，请关闭旧标签页后重试'));
    });
    this.db.onversionchange=()=>{this.db.close();this.db=null;}; return this.db;
  }
  async get(id) {
    const db=await this.open();return new Promise((resolve,reject)=>{
      const request=db.transaction('audio','readonly').objectStore('audio').get(id);
      request.onsuccess=()=>resolve(request.result?new Uint8Array(request.result):null);request.onerror=()=>reject(new Error('音频读取失败'));
    });
  }
  async put(id,bytes) {
    const db=await this.open();return new Promise((resolve,reject)=>{
      const tx=db.transaction('audio','readwrite');tx.objectStore('audio').put(new Uint8Array(bytes),id);
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error('浏览器音频保存失败，请导出工作包备份'));tx.onabort=()=>reject(new Error('浏览器音频保存被中断，请导出工作包备份'));
    });
  }
}
