export async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : {'Content-Type':'application/json'}, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({error:'The server returned an invalid response.'}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
export function download(data, name) {
  const blob = data instanceof Blob ? data : new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
