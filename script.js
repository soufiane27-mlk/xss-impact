(async () => {
  // ---------------- CONFIG ----------------
  const TARGET_USER_GROUP_ID = 1139; // user/group id to grant access to on every node              
  const LIMIT = Infinity;
  // -----------------------------------------
  const ROUTER = '/doc-vault/remote/router.php';
  const ALLOW_FULL = '1,1,1,1,1,1,1,1,1,1,1,1';
  const DENY_NONE = '0,0,0,0,0,0,0,0,0,0,0,0';
  let tid = 1;
  async function rpc(action, method, data) {
    const res = await fetch(ROUTER, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({ action, method, data, type: 'rpc', tid: tid++ }),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text, status: res.status };
    }
  }
  function isFolder(item) {
    return (
      item.isFolder === true ||
      item.extension === '' ||
      String(item.templateId ?? item.template_id) === '5' ||
      String(item.type).toLowerCase() === 'folder' ||
      String(item.iconCls ?? item.cls ?? '').toLowerCase().includes('folder')
    );
  }
  async function getChildren(nid, path) {
    const resp = await rpc('CB_BrowserView', 'getChildren', [
      { id: nid, nid, path: String(path), start: 0, page: 1, limit: '9999', rows: '9999', from: 'breadcrumb', query: '' },
    ]);
    return resp?.result?.data ?? [];
  }
  async function walk(nid, path, nodes) {
    const children = await getChildren(nid, path);
    for (const item of children) {
      const childNid = item.nid ?? item.id;
      nodes.push({ id: childNid, name: item.name, folder: isFolder(item) });
      if (isFolder(item)) {
        await walk(childNid, `${path}/${childNid}`, nodes);
      }
    }
  }
  async function setPermission(csrf, nodeId) {
    const acl = await rpc('CB_Security', 'getObjectAcl', [{ id: String(nodeId) }]);
    const entries = acl?.result?.data ?? acl?.result ?? [];
    const existing = Array.isArray(entries)
      ? entries.find((e) => String(e.user_group_id) === String(TARGET_USER_GROUP_ID))
      : null;
    if (existing) {
      return rpc('CB_Security', 'updateObjectAccess', [
        {
          id: String(nodeId),
          data: { ...existing, allow: ALLOW_FULL, deny: DENY_NONE },
          updateType: 'update',
          csrf,
          action_id: '',
        },
      ]);
    }
    return rpc('CB_Security', 'addObjectAccess', [
      {
        id: String(nodeId),
        data: [
          {
            id: 'AclRecord-2',
            user_group_id: TARGET_USER_GROUP_ID,
            allow: ALLOW_FULL,
            deny: DENY_NONE,
            phantom: true,
          },
        ],
        csrf,
      },
    ]);
  }
  let csrf = window.App?.loginData?.csrf;
  if (!csrf) {
    console.log('[!] App.loginData.csrf not found, falling back to CB_User.getLoginInfo...');
    const login = await rpc('CB_User', 'getLoginInfo', []);
    csrf = login?.result?.csrf ?? login?.result?.user?.csrf;
  }
  await rpc('CB_UsersGroups', 'saveTreeSelectedNode', [
    { id: '1', name: 'Home', path: '1', from: 'breadcrumb', page: 1 },
  ]);
  console.log('[*] Walking tree from root (nid=1)...');
  const nodes = [];
  await walk(1, '1', nodes);
  console.log(`[+] Discovered ${nodes.length} nodes.`);
  console.table(nodes.slice(0, 20));
  if (nodes.length > 20) console.log(`... and ${nodes.length - 20} more`);
  const target = nodes.slice(0, LIMIT);
  console.log(`[*] Applying permission changes to ${target.length} node(s) for user_group_id=${TARGET_USER_GROUP_ID}...`);
  for (const node of target) {
    const result = await setPermission(csrf, node.id);
    const ok = result?.result?.success ?? false;
    console.log(`${ok ? '%cOK  ' : '%cFAIL'} id=${node.id}  ${node.name}`, `color: ${ok ? 'green' : 'red'}`, !ok ? result : '');
  }
})();
