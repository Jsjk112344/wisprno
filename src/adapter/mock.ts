// Pioneer retains its source-based discovery and existing session options.
import {HttpTargetAdapter} from './http.ts';
export {AdapterError} from './http.ts';
export type {SessionOptions,Session,TurnReply,HandsetMessages} from './http.ts';
export class MockAdapter extends HttpTargetAdapter {}
