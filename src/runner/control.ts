import {AsyncLocalStorage} from 'node:async_hooks';
export class RunStopped extends Error {constructor(){super('Stopped by operator');}}
export class RunControl {
 stopped=false;confirmedBreach=false;private active=0;private waiters:(()=>void)[]=[];
 stop(){this.stopped=true;}
 check(){if(this.stopped)throw new RunStopped();}
 enter(){this.active++;return ()=>{this.active--;if(!this.active){for(const resolve of this.waiters)resolve();this.waiters=[];}};}
 async drain(){if(this.active)await new Promise<void>(r=>this.waiters.push(r));}
}
export const runControl=new AsyncLocalStorage<RunControl>();
export function checkRunActive(){runControl.getStore()?.check();}
