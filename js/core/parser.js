/**
 * 函数解析器
 * 输入：表达式字符串如 "x^2 + 2*x - 1"
 * 输出：可在指定 x 求值的函数
 *
 * 支持：
 * - 数字（整数、小数）
 * - 变量 x
 * - 常数 pi, e
 * - 运算符 + - * / ^ **（** 等价 ^）
 * - 一元负号
 * - 隐式乘法（2x = 2*x，2(x+1) = 2*(x+1)）
 * - 函数：sin, cos, tan, asin, acos, atan, sqrt, abs, log, ln, exp, floor, ceil, round
 * - 括号 ( )
 *
 * 实现：tokenize → shunting-yard → AST → eval
 */
const Parser = {
  /**
   * 主入口：编译表达式字符串为求值函数
   * @param {string} expr 表达式
   * @returns {{ fn: (x:number)=>number, error: string|null }}
   */
  compile(expr) {
    if (!expr || !expr.trim()) {
      return { fn: null, error: '请输入函数' };
    }
    try {
      // 预处理：把 ** 替换为 ^，把 |x| 替换为 abs(x)
      let cleaned = expr.replace(/\*\*/g, '^');
      // 处理 |...| 为 abs(...)
      cleaned = this._convertBars(cleaned);
      
      const tokens = this._tokenize(cleaned);
      const rpn = this._toRPN(tokens);
      const fn = this._buildFn(rpn);
      // 测试一次（用 x=1 试求值，捕获基础语法错）
      const test = fn(1);
      if (typeof test !== 'number' && !isNaN(test)) {
        // 仅检查不是抛错，结果是 NaN/Infinity 是合法的（如 1/0）
      }
      return { fn, error: null };
    } catch (e) {
      return { fn: null, error: e.message || '语法错误' };
    }
  },

  /**
   * 把 |...| 转为 abs(...)
   * 简单处理：找成对的 |，外层成对处理。嵌套不支持但够用了。
   */
  _convertBars(s) {
    let out = '';
    let inBar = false;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '|') {
        if (!inBar) {
          out += 'abs(';
          inBar = true;
        } else {
          out += ')';
          inBar = false;
        }
      } else {
        out += s[i];
      }
    }
    if (inBar) throw new Error('|...| 不匹配');
    return out;
  },

  /**
   * tokenize：把字符串切成 token 数组
   * token: { type: 'num'|'var'|'op'|'func'|'lparen'|'rparen'|'comma', value }
   */
  _tokenize(s) {
    const tokens = [];
    let i = 0;
    s = s.replace(/\s+/g, '');

    while (i < s.length) {
      const c = s[i];

      // 数字（含小数）
      if (/\d/.test(c) || (c === '.' && /\d/.test(s[i+1]))) {
        let num = '';
        while (i < s.length && /[\d.]/.test(s[i])) {
          num += s[i++];
        }
        tokens.push({ type: 'num', value: parseFloat(num) });
        continue;
      }

      // 标识符（变量/常数/函数）
      if (/[a-zA-Z_]/.test(c)) {
        let id = '';
        while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
          id += s[i++];
        }
        // 区分函数 / 常数 / 变量
        if (id === 'x') {
          tokens.push({ type: 'var', value: 'x' });
        } else if (id === 'pi' || id === 'PI' || id === 'Pi') {
          tokens.push({ type: 'num', value: Math.PI });
        } else if (id === 'e' || id === 'E') {
          tokens.push({ type: 'num', value: Math.E });
        } else if (this._FUNCS[id]) {
          tokens.push({ type: 'func', value: id });
        } else {
          throw new Error(`未知标识符：${id}`);
        }
        continue;
      }

      // 运算符
      if ('+-*/^'.includes(c)) {
        tokens.push({ type: 'op', value: c });
        i++;
        continue;
      }

      // 括号
      if (c === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
      if (c === ')') { tokens.push({ type: 'rparen' }); i++; continue; }

      // 逗号（多参函数预留）
      if (c === ',') { tokens.push({ type: 'comma' }); i++; continue; }

      throw new Error(`不识别的字符：${c}`);
    }

    return this._injectImplicitMul(tokens);
  },

  /**
   * 处理隐式乘法：2x → 2*x, 2(x+1) → 2*(x+1), x(x+1) → x*(x+1), (1)(2) → (1)*(2)
   * 规则：如果前一个是 num/var/rparen，下一个是 num/var/lparen/func，插一个 *
   */
  _injectImplicitMul(tokens) {
    const out = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const prev = out[out.length - 1];
      if (prev && t) {
        const prevIsValue = prev.type === 'num' || prev.type === 'var' || prev.type === 'rparen';
        const currIsValue = t.type === 'num' || t.type === 'var' || t.type === 'lparen' || t.type === 'func';
        if (prevIsValue && currIsValue) {
          out.push({ type: 'op', value: '*' });
        }
      }
      out.push(t);
    }
    return out;
  },

  /**
   * Shunting-yard：转 RPN（后缀）
   */
  _toRPN(tokens) {
    const output = [];
    const ops = [];
    const prec = { '+': 1, '-': 1, '*': 2, '/': 2, 'u-': 3, '^': 4 };
    const rightAssoc = { '^': true, 'u-': true };

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];

      if (t.type === 'num' || t.type === 'var') {
        output.push(t);
      } else if (t.type === 'func') {
        ops.push(t);
      } else if (t.type === 'op') {
        // 一元负号识别：表达式开头、左括号后、其他二元运算符后
        let isUnary = false;
        if (t.value === '-' || t.value === '+') {
          const prev = tokens[i - 1];
          if (!prev || (prev.type === 'op' && prev.value !== 'u-') || prev.type === 'lparen' || prev.type === 'comma' || prev.type === 'func') {
            isUnary = true;
          }
        }
        // 拒绝连续二元运算符（除非是一元）
        if (!isUnary) {
          const prev = tokens[i - 1];
          if (!prev || prev.type === 'op' || prev.type === 'lparen' || prev.type === 'comma') {
            throw new Error(`运算符 "${t.value}" 位置错误`);
          }
        }
        if (isUnary) {
          if (t.value === '-') {
            const u = { type: 'op', value: 'u-' };
            while (ops.length > 0) {
              const top = ops[ops.length - 1];
              if (top.type === 'op' && top.value !== 'u-' && (prec[top.value] > prec['u-'])) {
                output.push(ops.pop());
              } else break;
            }
            ops.push(u);
            // 把 u- 标记为这个 token，方便后续判断"这是一元运算符的位置"
            tokens[i] = u;
          }
          // 一元 + 直接忽略
        } else {
          while (ops.length > 0) {
            const top = ops[ops.length - 1];
            if (top.type === 'func') {
              output.push(ops.pop());
            } else if (top.type === 'op' && top.value !== '(' &&
                       (prec[top.value] > prec[t.value] ||
                        (prec[top.value] === prec[t.value] && !rightAssoc[t.value]))) {
              output.push(ops.pop());
            } else break;
          }
          ops.push(t);
        }
      } else if (t.type === 'lparen') {
        ops.push(t);
      } else if (t.type === 'rparen') {
        while (ops.length > 0 && ops[ops.length - 1].type !== 'lparen') {
          output.push(ops.pop());
        }
        if (ops.length === 0) throw new Error('括号不匹配');
        ops.pop();
        if (ops.length > 0 && ops[ops.length - 1].type === 'func') {
          output.push(ops.pop());
        }
      }
    }
    while (ops.length > 0) {
      const top = ops.pop();
      if (top.type === 'lparen' || top.type === 'rparen') {
        throw new Error('括号不匹配');
      }
      output.push(top);
    }
    return output;
  },

  /**
   * 构建求值函数（从 RPN 数组）
   */
  _buildFn(rpn) {
    const FUNCS = this._FUNCS;
    return function (x) {
      const stack = [];
      for (let i = 0; i < rpn.length; i++) {
        const t = rpn[i];
        if (t.type === 'num') {
          stack.push(t.value);
        } else if (t.type === 'var') {
          stack.push(x);
        } else if (t.type === 'op') {
          if (t.value === 'u-') {
            const a = stack.pop();
            stack.push(-a);
          } else {
            const b = stack.pop();
            const a = stack.pop();
            switch (t.value) {
              case '+': stack.push(a + b); break;
              case '-': stack.push(a - b); break;
              case '*': stack.push(a * b); break;
              case '/': stack.push(a / b); break;
              case '^': stack.push(Math.pow(a, b)); break;
              default: throw new Error('未知运算符 ' + t.value);
            }
          }
        } else if (t.type === 'func') {
          const a = stack.pop();
          stack.push(FUNCS[t.value](a));
        }
      }
      if (stack.length !== 1) throw new Error('表达式不完整');
      return stack[0];
    };
  },

  _FUNCS: {
    sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    sqrt: Math.sqrt,
    abs: Math.abs,
    log: Math.log10,  // 高中常用对数 log = log10
    ln: Math.log,     // 自然对数
    lg: Math.log10,   // 别名
    exp: Math.exp,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
  },
};
