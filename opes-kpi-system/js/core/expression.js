/**
 * Bộ đánh giá biểu thức an toàn cho công thức KPI tùy biến (không dùng eval/new Function).
 *
 * Hỗ trợ: số, biến (A, T, B, S, W, ...), + - * / %, so sánh (< <= > >= == !=),
 * && || !, toán tử ba ngôi c ? a : b, và các hàm:
 *   min, max, abs, round(x, d), floor, ceil, clamp(x, lo, hi), if(c, a, b),
 *   isnull(x), coalesce(a, b)
 *
 * Quy ước dữ liệu thiếu: biến null tham gia phép tính => kết quả null (không coi là 0).
 * Chia cho 0 => lỗi DIV_ZERO (công thức không hợp lệ cho dữ liệu đó).
 */

const FUNCTIONS = {
  min: { arity: [1, 20], fn: (...a) => (a.some((x) => x === null) ? null : Math.min(...a)) },
  max: { arity: [1, 20], fn: (...a) => (a.some((x) => x === null) ? null : Math.max(...a)) },
  abs: { arity: [1, 1], fn: (x) => (x === null ? null : Math.abs(x)) },
  floor: { arity: [1, 1], fn: (x) => (x === null ? null : Math.floor(x)) },
  ceil: { arity: [1, 1], fn: (x) => (x === null ? null : Math.ceil(x)) },
  round: {
    arity: [1, 2],
    fn: (x, d = 0) => {
      if (x === null || d === null) return null;
      const f = 10 ** d;
      return Math.round((x + Number.EPSILON) * f) / f;
    },
  },
  clamp: { arity: [3, 3], fn: (x, lo, hi) => (x === null || lo === null || hi === null ? null : Math.min(Math.max(x, lo), hi)) },
  isnull: { arity: [1, 1], fn: (x) => (x === null ? 1 : 0) },
  coalesce: { arity: [2, 10], fn: (...a) => { for (const x of a) if (x !== null) return x; return null; } },
};

export class ExpressionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (j < src.length && /[eE]/.test(src[j])) {
        j++;
        if (/[+-]/.test(src[j])) j++;
        while (j < src.length && /[0-9]/.test(src[j])) j++;
      }
      const text = src.slice(i, j);
      const value = Number(text);
      if (!Number.isFinite(value)) throw new ExpressionError('SYNTAX', `Số không hợp lệ: ${text}`);
      tokens.push({ t: 'num', v: value });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) { tokens.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/%<>!?:(),'.includes(c)) { tokens.push({ t: 'op', v: c }); i++; continue; }
    throw new ExpressionError('SYNTAX', `Ký tự không hợp lệ "${c}" tại vị trí ${i + 1}`);
  }
  return tokens;
}

function parse(src) {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
  const expect = (v) => {
    if (!isOp(v)) throw new ExpressionError('SYNTAX', `Thiếu "${v}"`);
    pos++;
  };

  function primary() {
    const tk = peek();
    if (!tk) throw new ExpressionError('SYNTAX', 'Biểu thức chưa hoàn chỉnh');
    if (tk.t === 'num') { pos++; return { k: 'num', v: tk.v }; }
    if (tk.t === 'id') {
      pos++;
      if (isOp('(')) {
        pos++;
        const args = [];
        if (!isOp(')')) {
          args.push(ternary());
          while (isOp(',')) { pos++; args.push(ternary()); }
        }
        expect(')');
        const name = tk.v.toLowerCase();
        if (name !== 'if' && !FUNCTIONS[name]) throw new ExpressionError('SYNTAX', `Hàm không được hỗ trợ: ${tk.v}`);
        if (name === 'if' && args.length !== 3) throw new ExpressionError('SYNTAX', 'Hàm if cần 3 tham số');
        if (FUNCTIONS[name]) {
          const [lo, hi] = FUNCTIONS[name].arity;
          if (args.length < lo || args.length > hi) throw new ExpressionError('SYNTAX', `Số tham số của ${name} không hợp lệ`);
        }
        return { k: 'call', name, args };
      }
      if (tk.v === 'true') return { k: 'num', v: 1 };
      if (tk.v === 'false') return { k: 'num', v: 0 };
      if (tk.v === 'null') return { k: 'null' };
      return { k: 'var', name: tk.v };
    }
    if (isOp('(')) { pos++; const e = ternary(); expect(')'); return e; }
    throw new ExpressionError('SYNTAX', `Không mong đợi "${tk.v}"`);
  }
  function unary() {
    if (isOp('-')) { pos++; return { k: 'neg', a: unary() }; }
    if (isOp('!')) { pos++; return { k: 'not', a: unary() }; }
    if (isOp('+')) { pos++; return unary(); }
    return primary();
  }
  function binary(next, ops) {
    return function () {
      let left = next();
      while (peek() && peek().t === 'op' && ops.includes(peek().v)) {
        const op = tokens[pos++].v;
        left = { k: 'bin', op, a: left, b: next() };
      }
      return left;
    };
  }
  const mul = binary(unary, ['*', '/', '%']);
  const add = binary(mul, ['+', '-']);
  const cmp = binary(add, ['<', '<=', '>', '>=', '==', '!=']);
  const andE = binary(cmp, ['&&']);
  const orE = binary(andE, ['||']);
  function ternary() {
    const c = orE();
    if (isOp('?')) {
      pos++;
      const a = ternary();
      expect(':');
      const b = ternary();
      return { k: 'tern', c, a, b };
    }
    return c;
  }
  const ast = ternary();
  if (pos < tokens.length) throw new ExpressionError('SYNTAX', `Thừa ký tự từ "${tokens[pos].v}"`);
  return ast;
}

function evaluate(node, vars) {
  switch (node.k) {
    case 'num': return node.v;
    case 'null': return null;
    case 'var': {
      if (!(node.name in vars)) throw new ExpressionError('UNKNOWN_VAR', `Biến không xác định: ${node.name}`);
      const v = vars[node.name];
      return v === undefined ? null : v;
    }
    case 'neg': { const a = evaluate(node.a, vars); return a === null ? null : -a; }
    case 'not': { const a = evaluate(node.a, vars); return a === null ? null : (a ? 0 : 1); }
    case 'tern': {
      const c = evaluate(node.c, vars);
      if (c === null) return null;
      return c ? evaluate(node.a, vars) : evaluate(node.b, vars);
    }
    case 'call': {
      if (node.name === 'if') {
        const c = evaluate(node.args[0], vars);
        if (c === null) return null;
        return c ? evaluate(node.args[1], vars) : evaluate(node.args[2], vars);
      }
      const args = node.args.map((a) => evaluate(a, vars));
      return FUNCTIONS[node.name].fn(...args);
    }
    case 'bin': {
      if (node.op === '&&') {
        const a = evaluate(node.a, vars);
        if (a === null) return null;
        if (!a) return 0;
        const b = evaluate(node.b, vars);
        return b === null ? null : (b ? 1 : 0);
      }
      if (node.op === '||') {
        const a = evaluate(node.a, vars);
        if (a) return 1;
        const b = evaluate(node.b, vars);
        if (a === null || b === null) return b ? 1 : null;
        return b ? 1 : 0;
      }
      const a = evaluate(node.a, vars);
      const b = evaluate(node.b, vars);
      if (a === null || b === null) return null;
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': if (b === 0) throw new ExpressionError('DIV_ZERO', 'Chia cho 0'); return a / b;
        case '%': if (b === 0) throw new ExpressionError('DIV_ZERO', 'Chia cho 0'); return a % b;
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        default: throw new ExpressionError('SYNTAX', `Toán tử không hỗ trợ ${node.op}`);
      }
    }
    default: throw new ExpressionError('SYNTAX', 'Nút không hợp lệ');
  }
}

const cache = new Map();

/** Biên dịch (có cache). Ném ExpressionError nếu sai cú pháp. */
export function compileExpression(src) {
  const key = String(src ?? '');
  if (!cache.has(key)) {
    if (!key.trim()) throw new ExpressionError('SYNTAX', 'Công thức trống');
    cache.set(key, parse(key));
  }
  return cache.get(key);
}

/** Tính giá trị biểu thức với tập biến. Trả về số hoặc null (dữ liệu thiếu). */
export function evaluateExpression(src, vars = {}) {
  const ast = compileExpression(src);
  const v = evaluate(ast, vars);
  if (v !== null && !Number.isFinite(v)) throw new ExpressionError('NAN', 'Kết quả không phải số hữu hạn');
  return v;
}

/** Kiểm tra cú pháp + biến được phép. Trả về { ok, error }. */
export function validateExpression(src, allowedVars = ['A', 'T', 'B', 'S', 'W']) {
  try {
    const ast = compileExpression(src);
    const unknown = [];
    (function walk(n) {
      if (!n) return;
      if (n.k === 'var' && !allowedVars.includes(n.name)) unknown.push(n.name);
      ['a', 'b', 'c'].forEach((k) => n[k] && walk(n[k]));
      (n.args || []).forEach(walk);
    })(ast);
    if (unknown.length) return { ok: false, error: `Biến không được phép: ${[...new Set(unknown)].join(', ')}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
