// Command-only VM scaffold, not native browser/SDK transport evidence.
// Fresh prototypes per fixture: production guards must still install normally.
export function transportCapabilities(window){
 class Element {setAttribute(name,value){this[name]=value}}
 class Image extends Element {} class Script extends Element {}
 for(const C of [Image,Script])Object.defineProperty(C.prototype,'src',{configurable:true,get(){return this._src||''},set(value){this._src=value}});
 Object.assign(window,{HTMLImageElement:Image,HTMLScriptElement:Script,Element,fetch:()=>Promise.resolve({status:204}),navigator:{},dispatchEvent:window.dispatchEvent||(()=>{})});
}
