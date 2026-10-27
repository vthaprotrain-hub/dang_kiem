/**
 * "Thêm KPI từ năm trước" – phần xử lý thuần (không phụ thuộc trình duyệt/Firebase) để kiểm thử độc lập.
 *
 * Phân loại từng chỉ tiêu trong kế hoạch kỳ trước:
 *   catalog   – KPI thuộc danh mục, đang sử dụng và được phép dùng → thêm lại dưới dạng "Từ kho" (phiên bản danh mục hiện hành)
 *   new       – KPI không có trong danh mục (tự tạo, được giao ngoài danh mục, hoặc đã bị xóa khỏi danh mục) → thêm như KPI tạo mới
 *   blocked   – KPI danh mục đang ngừng sử dụng / không áp dụng / KPI Private không còn quyền / phương pháp tính điểm không còn → không được chọn
 *   duplicate – đã có trong kế hoạch hiện tại → không được chọn
 */
export const CARRY = { CATALOG: 'catalog', NEW: 'new', BLOCKED: 'blocked', DUPLICATE: 'duplicate' };
export const CARRY_LABEL = {
  catalog: { label: 'Từ danh mục', color: 'green' },
  new: { label: 'Tạo mới', color: 'purple' },
  blocked: { label: 'Không được phép', color: 'red' },
  duplicate: { label: 'Đã có trong kế hoạch', color: 'gray' },
};

/** Trường chỉ có ý nghĩa ở kỳ cũ – không sao chép sang kỳ mới. */
const DROP = ['order', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy', 'source', 'state', 'parentItemId', 'catalogRef', 'catalogSnapshot',
  'assignmentId', 'assignedBy', 'assignedByName', 'assignedAt', 'assignNote', 'weightMode', 'minWeight', 'maxWeight', 'originalWeight', 'parentRef', 'copiedFrom', 'countInTotal'];

const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

export function stripSpec(spec) {
  const s = clone(spec || {});
  for (const k of DROP) delete s[k];
  return s;
}

/**
 * @param {object} o
 * @param {object} o.prevPlan       kế hoạch kỳ trước của chính người dùng
 * @param {object} o.catalog        { public: {id: kpi}, private: {id: kpi} } – chỉ gồm KPI người dùng được đọc
 * @param {object} o.currentPlan    kế hoạch kỳ hiện tại (có thể null)
 * @param {object} o.scoringPolicies phương pháp tính điểm của kỳ hiện tại
 * @param {object} o.kpiGroups      nhóm KPI hiện hành
 * @param {function} o.isApplicable (kpi) => boolean – phạm vi áp dụng theo vị trí/đơn vị hiện tại
 */
export function classifyCarryOver({ prevPlan, catalog = {}, currentPlan = null, scoringPolicies = {}, kpiGroups = {}, isApplicable = () => true }) {
  const pub = catalog.public || {}, priv = catalog.private || {};
  const prevItems = Object.entries(prevPlan?.items || {}).filter(([, it]) => it?.spec && it.spec.state !== 'revoked')
    .sort(([, a], [, b]) => (a.spec.order || 0) - (b.spec.order || 0));
  const cur = Object.values(currentPlan?.items || {}).filter((it) => it?.spec && it.spec.state !== 'revoked');
  const curCatIds = new Set(cur.map((it) => it.spec.catalogRef?.id).filter(Boolean));
  const curTitles = new Set(cur.map((it) => norm(it.spec.title)));
  const groupOk = (g) => !!kpiGroups[g] && (kpiGroups[g].status || 'active') === 'active';
  const policyOk = (p) => !!scoringPolicies[p] && (scoringPolicies[p].status || 'active') === 'active';
  const fallbackGroup = groupOk('grp_khac') ? 'grp_khac' : Object.keys(kpiGroups).find(groupOk) || null;

  const rows = prevItems.map(([id, it]) => {
    const s = it.spec;
    const row = { id, title: s.title, prevSource: s.source, weight: Number(it.weight) || 0, parentId: s.parentItemId || null, prevSpec: s, warnings: [] };
    const catId = s.catalogRef?.id;
    const rec = catId ? pub[catId] || priv[catId] : null;
    if (catId && rec) {
      row.catalogId = catId;
      row.catalog = rec;
      if (rec.status !== 'active') return { ...row, status: CARRY.BLOCKED, reason: `KPI ${rec.code || ''} trong danh mục đang ngừng sử dụng.` };
      if (!isApplicable(rec)) return { ...row, status: CARRY.BLOCKED, reason: `KPI ${rec.code || ''} không áp dụng cho vị trí/đơn vị hiện tại của bạn.` };
      if (!policyOk(rec.scoringPolicyId)) return { ...row, status: CARRY.BLOCKED, reason: 'Phương pháp tính điểm của KPI danh mục không còn hiệu lực trong kỳ này.' };
      if (curCatIds.has(catId) || curTitles.has(norm(s.title))) return { ...row, status: CARRY.DUPLICATE, reason: 'KPI này đã có trong kế hoạch kỳ hiện tại.' };
      if ((rec.version || 1) !== (s.catalogRef.version || 1)) row.warnings.push(`Danh mục đã cập nhật lên phiên bản ${rec.version} (năm trước dùng phiên bản ${s.catalogRef.version || 1}).`);
      return { ...row, status: CARRY.CATALOG, reason: `Hợp lệ – KPI ${rec.code || ''} đang sử dụng trong danh mục.` };
    }
    if (catId && (s.catalogRef?.visibility === 'private')) {
      return { ...row, status: CARRY.BLOCKED, reason: 'KPI Private năm trước không còn được cấp quyền sử dụng (hoặc đã bị xóa).' };
    }
    // Không thuộc danh mục → tạo mới
    if (!policyOk(s.scoring?.policyId)) return { ...row, status: CARRY.BLOCKED, reason: 'Phương pháp tính điểm năm trước không còn hiệu lực – hãy tạo KPI mới và chọn phương pháp khác.' };
    if (curTitles.has(norm(s.title))) return { ...row, status: CARRY.DUPLICATE, reason: 'KPI cùng tên đã có trong kế hoạch kỳ hiện tại.' };
    if (!groupOk(s.groupId)) {
      if (!fallbackGroup) return { ...row, status: CARRY.BLOCKED, reason: 'Nhóm KPI năm trước không còn tồn tại.' };
      row.groupOverride = fallbackGroup;
      row.warnings.push(`Nhóm KPI năm trước không còn – chuyển sang nhóm "${kpiGroups[fallbackGroup].name}".`);
    }
    const reason = catId ? 'KPI năm trước không còn trong danh mục – sẽ được tạo mới từ nội dung năm trước.'
      : s.source === 'assigned' ? 'KPI do cấp trên giao năm trước (không thuộc danh mục) – sẽ được tạo mới như KPI tự xây dựng.'
        : s.source === 'sub' ? 'Sub-KPI tự tạo năm trước – sẽ được tạo mới.'
          : 'KPI tự tạo năm trước (không thuộc danh mục) – sẽ được tạo mới.';
    return { ...row, status: CARRY.NEW, reason };
  });

  // Sub-KPI phụ thuộc KPI cha: KPI cha không chọn được thì sub-KPI cũng không chọn được
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  for (const r of rows) {
    if (!r.parentId) continue;
    const p = byId[r.parentId];
    if (!p) { r.parentId = null; continue; }
    r.depth = (p.depth || 0) + 1;
    if ([CARRY.CATALOG, CARRY.NEW].includes(r.status) && ![CARRY.CATALOG, CARRY.NEW].includes(p.status)) {
      r.status = CARRY.BLOCKED;
      r.reason = 'Sub-KPI chỉ được sao chép cùng KPI cha – KPI cha không chọn được.';
    }
  }
  for (const r of rows) {
    r.selectable = [CARRY.CATALOG, CARRY.NEW].includes(r.status);
    // Mặc định chọn KPI tự xây dựng; KPI do cấp trên giao năm trước để người dùng tự quyết (cấp trên có thể giao lại năm nay)
    const root = r.parentId ? rootOf(r, byId) : r;
    r.defaultSelected = r.selectable && root.prevSource !== 'assigned';
  }
  return rows;
}

function rootOf(r, byId) {
  let cur = r;
  const seen = new Set();
  while (cur.parentId && byId[cur.parentId] && !seen.has(cur.id)) { seen.add(cur.id); cur = byId[cur.parentId]; }
  return cur;
}

/** Danh sách id được chọn hợp lệ: bỏ sub-KPI có KPI cha không được chọn. */
export function effectiveSelection(rows, selected) {
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const ok = (r) => r.selectable && selected.has(r.id) && (!r.parentId || ok(byId[r.parentId]));
  return rows.filter(ok);
}

/**
 * Tạo nội dung chỉ tiêu mới cho kỳ hiện tại từ các dòng đã chọn.
 * @param {function} catalogSpec (kpi, kpiId) => spec chuẩn từ danh mục hiện hành
 * @returns [{ fromId, parentFromId, source, spec, weight }]
 */
export function buildCarryItems(rows, selected, { weights = {}, keepTargets = true, catalogSpec, sourcePeriodId }) {
  const chosen = effectiveSelection(rows, selected);
  const chosenIds = new Set(chosen.map((r) => r.id));
  const hasKids = (id) => chosen.some((r) => r.parentId === id);
  return chosen.map((r) => {
    const prev = r.prevSpec;
    const isSub = !!r.parentId && chosenIds.has(r.parentId);
    let spec;
    if (r.status === CARRY.CATALOG) {
      spec = catalogSpec(r.catalog, r.catalogId);
      // giữ tên/diễn giải người dùng đã điều chỉnh năm trước
      if (prev.title) spec.title = prev.title;
      if (prev.description) spec.description = prev.description;
      if (keepTargets && prev.targets && Object.keys(prev.targets).length) spec.targets = clone(prev.targets);
    } else {
      spec = stripSpec(prev);
      if (r.groupOverride) spec.groupId = r.groupOverride;
    }
    if (hasKids(r.id) && prev.aggregation) spec.aggregation = clone(prev.aggregation);
    else delete spec.aggregation;
    spec.copiedFrom = { periodId: sourcePeriodId, itemId: r.id, status: r.status };
    const w = weights[r.id] !== undefined && weights[r.id] !== '' ? Number(weights[r.id]) : r.weight;
    return { fromId: r.id, parentFromId: isSub ? r.parentId : null, source: isSub ? 'sub' : r.status === CARRY.CATALOG ? 'catalog' : 'custom', spec, weight: w };
  });
}
