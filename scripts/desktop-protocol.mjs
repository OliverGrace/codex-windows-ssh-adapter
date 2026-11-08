import {parse} from 'acorn';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {classifyCommand,desktopForwardPort,parseSshArgs} from '../src/commands.mjs';

const isFunction=n=>/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type);
function walk(node,visit,parents=[]) {
  if(!node?.type)return;
  if(visit(node,parents)===false)return;
  for(const value of Object.values(node)) {
    if(Array.isArray(value))for(const child of value)walk(child,visit,[...parents,node]);
    else if(value?.type)walk(value,visit,[...parents,node]);
  }
}
function bindings(pattern,result) {walk(pattern,n=>{if(n.type==='Identifier')result.add(n.name);});}
function references(root) {
  const bound=new Set(),used=new Set();
  walk(root,(n,parents)=>{
    if(isFunction(n)){if(n.id)bound.add(n.id.name);for(const p of n.params)bindings(p,bound);}
    if(n.type==='VariableDeclarator')bindings(n.id,bound);
    if(n.type==='CatchClause')bindings(n.param,bound);
    if(n.type!=='Identifier')return;
    const p=parents.at(-1);
    if(p?.type==='MemberExpression'&&p.property===n&&!p.computed)return;
    if(p?.type==='Property'&&p.key===n&&!p.computed&&!p.shorthand)return;
    used.add(n.name);
  });
  return [...used].filter(n=>!bound.has(n));
}
function definitions(scope) {
  const found=new Map();
  const add=(name,node)=>{if(found.has(name))found.set(name,null);else found.set(name,node);};
  walk(scope,n=>{
    if(n!==scope&&isFunction(n)){if(n.type==='FunctionDeclaration')add(n.id.name,n);return false;}
    if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'&&n.init)add(n.id.name,n.init);
    if(n.type==='ClassDeclaration')return false;
  });
  return found;
}

// Inspect syntax rather than version numbers or generated symbol/file names.
// Evaluate only the formatter and its lexical dependencies, never a bundle/module.
export function extractFormatter(source) {
  const tree=parse(source,{ecmaVersion:'latest',sourceType:'script'}),candidates=[];
  walk(tree,(node,parents)=>{
    if(isFunction(node)&&source.slice(node.start,node.end).includes('CODEX_REMOTE_PAYLOAD'))candidates.push({node,parents});
  });
  const smallest=candidates.filter(c=>!candidates.some(other=>other!==c&&other.node.start>c.node.start&&other.node.end<c.node.end));
  if(smallest.length!==1)throw Error('Desktop SSH formatter missing or ambiguous');
  const {node,parents}=smallest[0];
  if(node.end-node.start>12000)throw Error('Desktop SSH formatter is no longer a small function');
  const scopes=parents.filter(p=>p.type==='Program'||isFunction(p)).reverse().map(definitions);
  const declarations=[],resolved=new Set(),resolving=new Set();
  const globals=new Set(['Array','String','Number','Boolean','Math','JSON','RegExp','undefined']);
  function resolve(name) {
    if(globals.has(name)||resolved.has(name))return;
    if(resolving.has(name))throw Error('Cyclic Desktop formatter dependency');
    const scope=scopes.find(s=>s.has(name)),dependency=scope?.get(name);
    if(!dependency||dependency.end-dependency.start>12000)throw Error('Unsupported Desktop formatter dependency: '+name);
    resolving.add(name);
    for(const ref of references(dependency))resolve(ref);
    declarations.push(`const ${name}=(${source.slice(dependency.start,dependency.end)});`);
    resolving.delete(name);resolved.add(name);
    if(resolved.size>20)throw Error('Too many Desktop formatter dependencies');
  }
  for(const ref of references(node))resolve(ref);
  const context=vm.createContext({}, {codeGeneration:{strings:false,wasm:false}});
  new vm.Script(`"use strict"; ${declarations.join('\n')} const formatter=(${source.slice(node.start,node.end)});`).runInContext(context,{timeout:1000});
  const invoke=new vm.Script('formatter(payload,marker)');
  return (payload,marker)=>{
    context.payload=payload;context.marker=marker==null?null:Array.from(marker);
    try {const result=invoke.runInContext(context,{timeout:1000});if(typeof result!=='string'||result.length>65536)throw Error('Invalid Desktop SSH command');return result;}
    finally {delete context.payload;delete context.marker;}
  };
}

export function checkFormatter(wrap,bootstrapPrefix='') {
  const proxy='if [ -S "${SSH_AUTH_SOCK:-}" ]; then true; fi && exec codex app-server proxy';
  const operations=[
    ['if command -v codex >/dev/null 2>&1; then exit 0; fi; exit 86','lookup'],
    ['codex --version','version'],
    [bootstrapPrefix+'if [ "${CODEX_SSH_SKIP_APP_SERVER_BOOT:-}" = "true" ]; then exit 0; fi; nohup codex app-server --listen unix://','bootstrap'],
    [proxy,'proxy'],['uname -s','platform'],
    [`pkill -9 -U "$(id -u)" -f 'codex.* app-server.* --listen'`,'kill']
  ];
  for(const marker of [null,Buffer.from([0,10,39,92,127,128,254,255])])for(const [payload,operation] of operations){
    const parsed=classifyCommand(wrap(payload,marker));
    assert.equal(parsed?.operation,operation,'Desktop SSH command changed: '+operation);
    assert.deepEqual(parsed.marker,marker,'Desktop binary marker changed');
  }
  const mcp=classifyCommand(wrap(`listeners=$(awk 'probe' /proc/net/tcp /proc/net/tcp6) || exit 1\n[ "$listeners" = '0100007F:1234' ] || exit 1\n${proxy}`,Buffer.alloc(8,255)));
  assert.equal(desktopForwardPort(parseSshArgs(['-R','127.0.0.1:4660:127.0.0.1:4660','example','command']),mcp),4660);
  assert.equal(classifyCommand(wrap("echo '中文 O'\\''Brien'",null))?.operation,'unsupported');
  return operations.length+1;
}

export function inspectSources(sources) {
  const candidates=sources.filter(s=>s.source.includes('CODEX_REMOTE_PAYLOAD'));
  if(candidates.length!==1)throw Error('Desktop SSH formatter bundle missing or ambiguous');
  for(const token of ['app-server proxy','CODEX_SSH_SKIP_APP_SERVER_BOOT','pkill -9'])
    if(!sources.some(s=>s.source.includes(token)))throw Error('Desktop SSH protocol signal missing: '+token);
  // Inspect the actual bootstrap builder too: a compatible wrapper alone does
  // not prove that a new prelude will reach the adapter's bootstrap handler.
  const prefixes=new Set();
  for(const {source} of sources.filter(s=>s.source.includes('CODEX_SSH_SKIP_APP_SERVER_BOOT'))) {
    walk(parse(source,{ecmaVersion:'latest',sourceType:'script'}),node=>{
      if(node.type!=='ArrayExpression')return;
      const at=node.elements.findIndex(e=>e?.type==='Literal'&&typeof e.value==='string'&&e.value.startsWith('if [ "${CODEX_SSH_SKIP_APP_SERVER_BOOT:-}"'));
      if(at<0)return;
      const before=node.elements.slice(0,at);
      if(before.some(e=>e?.type!=='Literal'||typeof e.value!=='string'))throw Error('Unknown Desktop bootstrap prelude');
      prefixes.add(before.map(e=>e.value).join(''));
    });
  }
  if(prefixes.size!==1)throw Error('Desktop bootstrap builder missing or ambiguous');
  const bootstrapPrefix=[...prefixes][0];
  const wrap=extractFormatter(candidates[0].source),checks=checkFormatter(wrap,bootstrapPrefix);
  return {wrap,checks,bootstrapPrefix,formatterBundle:candidates[0].name};
}
