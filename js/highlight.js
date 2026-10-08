/* CodeMotion — lightweight syntax tokenizer.
   Produces per-line token buckets consumed by the canvas renderer.

   Output shape:
     tokenize(text, langId) -> { lines: [ [ {type, text} ] ] }
   Token types map to theme color keys in themes.js.                      */
(function (CM) {
  'use strict';

  function words(s) { return s.trim().split(/\s+/).filter(Boolean); }

  var PY_BUILTIN = words(`
    abs all any ascii bin bool bytearray bytes callable chr classmethod compile complex delattr dict
    divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash hex id
    input int isinstance issubclass iter len list locals map max memoryview min next object oct open
    ord pow print property range repr reversed round set setattr slice sorted staticmethod str sum
    super tuple type vars zip __import__ __name__ __main__ Exception ValueError TypeError KeyError
    IndexError RuntimeError StopIteration NotImplementedError
  `);

  var PY_TYPE = words(`bool bytes complex dict float frozenset int list object set str tuple`);

  var JS_KEYWORD = words(`
    await break case catch class const continue debugger default delete do else enum export extends
    finally for function if implements import in instanceof interface let new of package private
    protected public return static super switch this throw try typeof var void while with yield async
    from as get set declare namespace type readonly abstract satisfies keyof infer
  `);

  var JS_BUILTIN = words(`
    Array Boolean Date Error EvalError Function Infinity JSON Map Math NaN Number Object Promise
    Proxy RangeError ReferenceError Reflect RegExp Set String Symbol TypeError URIError WeakMap
    WeakSet console document window fetch localStorage sessionStorage globalThis setTimeout
    setInterval clearTimeout clearInterval requestAnimationFrame parseInt parseFloat isNaN
    structuredClone queueMicrotask TextEncoder TextDecoder URL URLSearchParams AbortController
    Uint8Array Int8Array Uint16Array Int32Array Float32Array Float64Array ArrayBuffer
  `);

  var TS_EXTRA = words(`
    string number boolean any unknown never object symbol bigint void Record Partial Readonly Pick
    Omit Exclude Extract ReturnType Parameters ConstructorParameters InstanceType Awaited
  `);

  var LANG = {
    python: {
      label: 'Python',
      lineComments: ['#'],
      blockComments: [],
      strings: [
        { open: '"""', close: '"""', multiline: true, esc: false },
        { open: "'''", close: "'''", multiline: true, esc: false },
        { open: '"', close: '"', multiline: false, esc: true },
        { open: "'", close: "'", multiline: false, esc: true }
      ],
      keywords: words(`
        and as assert async await break class continue def del elif else except finally for from
        global if import in is lambda match case nonlocal not or pass raise return try while with yield
      `),
      constants: words(`True False None NotImplemented Ellipsis self cls __name__ __main__`),
      builtins: PY_BUILTIN,
      types: PY_TYPE
    },

    javascript: {
      label: 'JavaScript',
      lineComments: ['//'],
      blockComments: [['/*', '*/']],
      strings: [
        { open: '`', close: '`', multiline: true, esc: true },
        { open: '"', close: '"', multiline: false, esc: true },
        { open: "'", close: "'", multiline: false, esc: true }
      ],
      keywords: JS_KEYWORD,
      constants: words('true false null undefined NaN Infinity arguments globalThis'),
      builtins: JS_BUILTIN,
      types: []
    },

    typescript: {
      label: 'TypeScript',
      lineComments: ['//'],
      blockComments: [['/*', '*/']],
      strings: [
        { open: '`', close: '`', multiline: true, esc: true },
        { open: '"', close: '"', multiline: false, esc: true },
        { open: "'", close: "'", multiline: false, esc: true }
      ],
      keywords: JS_KEYWORD.concat(words(`
        interface type enum implements declare namespace abstract public private protected readonly
      `)),
      constants: words('true false null undefined NaN Infinity this'),
      builtins: JS_BUILTIN,
      types: TS_EXTRA.concat(words('string number boolean any unknown never void object symbol bigint'))
    },

    java: {
      label: 'Java',
      lineComments: ['//'],
      blockComments: [['/*', '*/']],
      strings: [
        { open: '"', close: '"', multiline: false, esc: true },
        { open: "'", close: "'", multiline: false, esc: true }
      ],
      keywords: words(`
        abstract assert break case catch class const continue default do else enum extends final
        finally for goto if implements import instanceof interface native new package private
        protected public return static strictfp super switch synchronized this throw throws
        transient try var volatile while record sealed permits yield
      `),
      constants: words('true false null this super'),
      builtins: words(`
        String Integer Double Long Float Boolean Character Byte Short Object Math System Thread
        Runnable Exception RuntimeException List ArrayList Map HashMap Set HashSet Optional Stream
        Arrays Collections Scanner
      `),
      types: words('int long double float char boolean void byte short var')
    },

    c: {
      label: 'C',
      lineComments: ['//'],
      blockComments: [['/*', '*/']],
      strings: [{ open: '"', close: '"', multiline: false, esc: true }],
      keywords: words(`
        auto break case const continue default do else enum extern for goto if inline register
        restrict return sizeof static struct switch typedef union volatile while _Alignas _Atomic
      `),
      constants: words('NULL true false'),
      builtins: words(`
        int char long short unsigned signed float double void size_t int8_t int16_t int32_t int64_t
        uint8_t uint16_t uint32_t uint64_t FILE printf scanf malloc calloc free memcpy memset strlen
      `),
      types: words('int char long short unsigned signed float double void size_t')
    },

    cpp: {
      label: 'C++',
      lineComments: ['//'],
      blockComments: [['/*', '*/']],
      strings: [{ open: '"', close: '"', multiline: false, esc: true }],
      keywords: words(`
        alignas alignof and asm auto break case catch class concept const consteval constexpr
        continue co_await co_return co_yield decltype default delete do dynamic_cast else enum
        explicit export false for friend goto if inline mutable namespace new noexcept not nullptr
        operator or private protected public register reinterpret_cast requires return short signed
        sizeof static static_assert static_cast struct switch template this throw true try typedef
        typeid typename union unsigned using virtual volatile while
      `),
      constants: words('true false nullptr NULL'),
      builtins: words(`
        string vector map set unordered_map unordered_set deque list array pair unique_ptr
        shared_ptr optional variant tuple cin cout cerr endl std printf size_t int32_t uint32_t
      `),
      types: words('int char long short unsigned signed float double void bool size_t auto string')
    },

    go: {
      label: 'Go',
      lineComments: ['//'],
      blockComments: [['/*', '*/']],
      strings: [
        { open: '`', close: '`', multiline: true, esc: false },
        { open: '"', close: '"', multiline: false, esc: true }
      ],
      keywords: words(`
        break case chan const continue default defer else fallthrough for func go goto if import
        interface map package range return select struct switch type var
      `),
      constants: words('true false nil iota'),
      builtins: words(`
        string int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 byte rune float32 float64
        bool error make new len cap append copy delete panic recover print println fmt os
      `),
      types: words('string int bool error byte rune float64 int64 uint64')
    },

    rust: {
      label: 'Rust',
      lineComments: ['//'],
      blockComments: [['/*', '*/']],
      strings: [{ open: '"', close: '"', multiline: false, esc: true }],
      keywords: words(`
        as async await break const continue crate dyn else enum extern fn for if impl in let loop
        match mod move mut pub ref return self Self static struct super trait type unsafe use where
        while union
      `),
      constants: words('true false None Some Ok Err'),
      builtins: words(`
        String Vec Option Result Box Rc Arc HashMap HashSet BTreeMap i8 i16 i32 i64 u8 u16 u32 u64
        usize isize f32 f64 bool char str println vec format panic
      `),
      types: words('String Vec Option Result Box u8 u32 u64 usize i32 i64 f32 f64 bool char str')
    },

    php: {
      label: 'PHP',
      lineComments: ['//', '#'],
      blockComments: [['/*', '*/']],
      strings: [{ open: '"', close: '"', multiline: false, esc: true },
                { open: "'", close: "'", multiline: false, esc: true }],
      keywords: words(`
        abstract and array as break callable case catch class clone const continue declare
        default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum
        extends final finally fn for foreach function global goto if implements include include_once
        instanceof insteadof interface isset list match namespace new or print private protected
        public readonly require require_once return static switch throw trait try unset use var
        while xor yield
      `),
      constants: words('true false null TRUE FALSE NULL __DIR__ __FILE__'),
      builtins: words(`
        strlen str_replace array_map array_filter count implode explode json_encode json_decode
        is_array is_null isset unset printf sprintf fopen fwrite file_get_contents
      `),
      types: []
    },

    ruby: {
      label: 'Ruby',
      lineComments: ['#'],
      blockComments: [],
      strings: [{ open: '"', close: '"', multiline: false, esc: true },
                { open: "'", close: "'", multiline: false, esc: true }],
      keywords: words(`
        alias and begin break case class def defined? do else elsif end ensure for if in module
        next not or redo rescue retry return self super then undef unless until when while yield
        require require_relative attr_accessor attr_reader attr_writer puts lambda proc
      `),
      constants: words('true false nil'),
      builtins: words(`puts print p pp raise loop each map select reject include? extend freeze new`),
      types: []
    },

    sql: {
      label: 'SQL',
      lineComments: ['--'],
      blockComments: [['/*', '*/']],
      strings: [{ open: "'", close: "'", multiline: false, esc: false }],
      keywords: words(`
        ADD ALL ALTER AND AS ASC BEGIN BETWEEN BY CASE COLUMN CONSTRAINT CREATE CROSS DEFAULT
        DELETE DESC DISTINCT DROP ELSE END EXISTS FOREIGN FROM FULL GROUP HAVING IF IN INDEX INNER
        INSERT INTO IS JOIN KEY LEFT LIKE LIMIT NOT NULL OFFSET ON OR ORDER OUTER PRIMARY REFERENCES
        RIGHT ROLLBACK SELECT SET TABLE THEN TRANSACTION UNION UNIQUE UPDATE VALUES VIEW WHEN WHERE
      `),
      constants: words('TRUE FALSE NULL'),
      builtins: words(`
        COUNT SUM AVG MIN MAX UPPER LOWER LENGTH COALESCE CAST NOW CURRENT_TIMESTAMP CONCAT
        ROW_NUMBER RANK DENSE_RANK
      `),
      types: words(`INT INTEGER VARCHAR TEXT DATE TIMESTAMP BOOLEAN BIGINT DECIMAL FLOAT`)
    },

    bash: {
      label: 'Shell',
      lineComments: ['#'],
      blockComments: [],
      strings: [{ open: '"', close: '"', multiline: false, esc: true },
                { open: "'", close: "'", multiline: false, esc: false }],
      keywords: words(`
        if then else elif fi for while until do done case esac function in return exit break continue
        local export source alias set unset trap shift
      `),
      constants: words('true false'),
      builtins: words(`
        echo cd ls cp mv rm mkdir rmdir cat grep sed awk curl wget git npm npx node python3 pip
        docker kubectl sudo chmod chown tar ssh scp ps kill jq make gcc
      `),
      types: []
    },

    json: {
      label: 'JSON',
      lineComments: [],
      blockComments: [],
      strings: [{ open: '"', close: '"', multiline: false, esc: true }],
      keywords: [],
      constants: words('true false null'),
      builtins: [],
      types: [],
      jsonMode: true
    },

    yaml: {
      label: 'YAML',
      lineComments: ['#'],
      blockComments: [],
      strings: [{ open: '"', close: '"', multiline: false, esc: true },
                { open: "'", close: "'", multiline: false, esc: true }],
      keywords: [],
      constants: words('true false null yes no on off ~'),
      builtins: [],
      types: [],
      yamlMode: true
    },

    markdown: {
      label: 'Markdown',
      lineComments: [],
      blockComments: [],
      strings: [],
      keywords: [],
      constants: [],
      builtins: [],
      types: [],
      mdMode: true
    },

    html: {
      label: 'HTML',
      lineComments: [],
      blockComments: [['<!--', '-->']],
      strings: [{ open: '"', close: '"', multiline: false, esc: true },
                { open: "'", close: "'", multiline: false, esc: true }],
      keywords: [],
      constants: [],
      builtins: [],
      types: [],
      htmlMode: true
    },

    css: {
      label: 'CSS',
      lineComments: [],
      blockComments: [['/*', '*/']],
      strings: [{ open: '"', close: '"', multiline: false, esc: true },
                { open: "'", close: "'", multiline: false, esc: true }],
      keywords: words(`important inherit initial unset auto none`),
      constants: words('true false'),
      builtins: [],
      types: [],
      cssMode: true
    },

    plain: { label: 'Plain Text', lineComments: [], blockComments: [], strings: [], keywords: [], constants: [], builtins: [], types: [] }
  };

  /* ---- fast membership sets ------------------------------------------------ */
  function setOf(arr) { var s = Object.create(null); for (var i = 0; i < arr.length; i++) s[arr[i]] = 1; return s; }
  Object.keys(LANG).forEach(function (k) {
    var L = LANG[k];
    L._kw = setOf(L.keywords); L._bi = setOf(L.builtins);
    L._ty = setOf(L.types); L._co = setOf(L.constants);
  });

  /* ---- special-case line handlers ----------------------------------------- */

  function mdInline(toks, text) {
    var inline = /(`[^`]*`|\*\*[^*]+\*\*|\*[^*]+\*)/g, last = 0, m2;
    while ((m2 = inline.exec(text))) {
      if (m2.index > last) toks.push({ type: 'text', text: text.slice(last, m2.index) });
      var inner = m2[1], ty = inner[0] === '`' ? 'string' : 'keyword';
      toks.push({ type: ty, text: inner });
      last = m2.index + inner.length;
    }
    if (last < text.length) toks.push({ type: 'text', text: text.slice(last) });
  }

  function mdLine(line) {
    var t = [];
    var h = /^(#{1,6})\s/.exec(line);
    if (h) { t.push({ type: 'keyword', text: h[1] + ' ' }); t.push({ type: 'fn', text: line.slice(h[0].length) }); return t; }
    var b = /^(\s*)((?:```|~~~).*)$/.exec(line);
    if (b) { t.push({ type: 'ws', text: b[1] }, { type: 'string', text: b[2] }); return t; }
    var q = /^(\s*)([A-Za-z0-9_.-]{1,12}:)(.*)$/.exec(line);
    if (q && !/^\s*([-*+]|\d+\.)\s/.test(line)) {
      t.push({ type: 'ws', text: q[1] }, { type: 'type', text: q[2] });
      mdInline(t, q[3]);
      return t;
    }
    var m = /^(\s*([-*+]|\d+\.)\s)([\s\S]*)$/.exec(line);
    if (m) {
      t.push({ type: 'ws', text: m[1].slice(0, m[1].length - m[2].length - 1) });
      t.push({ type: 'operator', text: m[2] + ' ' });
      mdInline(t, m[3]);
      return t;
    }
    mdInline(t, line);
    return t.length ? t : [{ type: 'ws', text: line }];
  }

  function yamlLine(line) {
    var m = /^(\s*(?:-\s+)?)([\w.$-]+)(\s*:)(.*)$/.exec(line);
    if (!m) {
      var c = /^(\s*)(#.*)$/.exec(line);
      if (c) return [{ type: 'ws', text: c[1] }, { type: 'comment', text: c[2] }];
      return [{ type: 'text', text: line }];
    }
    var t = [{ type: 'ws', text: m[1] }, { type: 'type', text: m[2] }, { type: 'operator', text: m[3] }];
    var rest = m[4];
    var lead = /^\s*/.exec(rest)[0];
    var restTrim = rest.slice(lead.length);
    if (restTrim === '') t.push({ type: 'text', text: rest });
    else if (LANG.yaml._co[restTrim]) t.push({ type: 'ws', text: lead }, { type: 'constant', text: restTrim });
    else if (/^-?\d+(\.\d+)?$/.test(restTrim)) t.push({ type: 'ws', text: lead }, { type: 'number', text: restTrim });
    else if (/^["'].*["']$/.test(restTrim)) t.push({ type: 'ws', text: lead }, { type: 'string', text: restTrim });
    else t.push({ type: 'ws', text: lead }, { type: 'text', text: restTrim });
    return t;
  }

  var RE_ATTRQ = /^"(?:\\.|[^"\\])*"|^'(?:\\.|[^'\\])*'/;
  var RE_ATTR = /^[A-Za-z_:][\w:.-]*/;

  function htmlLine(line, state) {
    var t = [], i = 0;

    while (i < line.length) {
      /* continue an unterminated comment from a previous line */
      if (state.inComment) {
        var ce = line.indexOf('-->');
        if (ce === -1) { t.push({ type: 'comment', text: line.slice(i) }); i = line.length; }
        else { t.push({ type: 'comment', text: line.slice(i, ce + 3) }); i = ce + 3; state.inComment = false; }
        continue;
      }

      var lt = line.indexOf('<', i);
      if (lt === -1) { t.push({ type: 'text', text: line.slice(i) }); break; }
      if (lt > i) t.push({ type: 'text', text: line.slice(i, lt) });

      if (line.startsWith('<!--', lt)) {
        var cm = line.indexOf('-->', lt);
        var stop = cm === -1 ? line.length : cm + 3;
        t.push({ type: 'comment', text: line.slice(lt, stop) });
        i = stop;
        if (cm === -1) state.inComment = true;
        continue;
      }

      var gt = line.indexOf('>', lt);
      if (gt === -1) { t.push({ type: 'text', text: line.slice(lt) }); break; }

      t.push({ type: 'operator', text: line[lt] });
      var j = lt + 1;
      var tag = /^\/?[A-Za-z][\w:-]*/.exec(line.slice(j));
      if (tag) { t.push({ type: 'keyword', text: tag[0] }); j += tag[0].length; }

      while (j < gt) {
        if (/[ \t]/.test(line[j])) { t.push({ type: 'ws', text: line[j] }); j++; continue; }
        var q = RE_ATTRQ.exec(line.slice(j));
        if (q) { t.push({ type: 'string', text: q[0] }); j += q[0].length; continue; }
        var nv = RE_NUM.exec(line.slice(j));
        if (nv) { t.push({ type: 'number', text: nv[0] }); j += nv[0].length; continue; }
        var at = RE_ATTR.exec(line.slice(j));
        if (at) {
          t.push({ type: 'type', text: at[0] });
          j += at[0].length;
          while (j < gt && /[ \t]/.test(line[j])) { t.push({ type: 'ws', text: line[j] }); j++; }
          if (line[j] === '=') { t.push({ type: 'operator', text: '=' }); j++; }
          continue;
        }
        t.push({ type: 'punct', text: line[j] }); j++;
      }

      if (line[gt - 1] === '/') {
        var slash = t.length - 1;
        while (slash >= 0 && t[slash].type !== 'operator') slash--;
        if (slash >= 0 && t[slash].text === '>') t[slash] = { type: 'punct', text: '/' };
      }
      t.push({ type: 'operator', text: line[gt] });
      i = gt + 1;
    }

    return t.length ? t : [{ type: 'ws', text: line }];
  }

  function cssLine(line, inComment) {
    var t = [];
    var work = line;
    if (inComment) {
      var e = work.indexOf('*/');
      if (e === -1) return [{ type: 'comment', text: work }];
      t.push({ type: 'comment', text: work.slice(0, e + 2) });
      work = work.slice(e + 2);
    }
    var i = 0, m;
    var re = /(\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(@[A-Za-z-]+)|(-?\d*\.?\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr|ch|pt|vmin|vmax)?)|([.#][A-Za-z_][\w-]*|::?[A-Za-z-]+)|([A-Za-z-]+)(?=\s*:)|([{}();,:])/g;
    while ((m = re.exec(work))) {
      if (m.index > i) t.push({ type: 'text', text: work.slice(i, m.index) });
      i = m.index + m[0].length;
      if (m[1]) t.push({ type: 'comment', text: m[1] });
      else if (m[2]) t.push({ type: 'string', text: m[2] });
      else if (m[3]) t.push({ type: 'keyword', text: m[3] });
      else if (m[4]) t.push({ type: 'number', text: m[4] });
      else if (m[5]) t.push({ type: 'type', text: m[5] });
      else if (m[6]) t.push({ type: 'fn', text: m[6] });
      else t.push({ type: 'operator', text: m[7] });
    }
    if (i < work.length) t.push({ type: 'text', text: work.slice(i) });
    return t.length ? t : [{ type: 'ws', text: work }];
  }

  /* ---- generic line tokenizer ------------------------------------------ */

  function firstStartAt(text, i, arr) {
    if (!arr) return null;
    for (var k = 0; k < arr.length; k++) {
      if (text.startsWith(arr[k], i)) return arr[k];
    }
    return null;
  }

  var RE_WS = /^[ \t]+/;
  var RE_NUM = /^0[xXbBoO][0-9a-fA-F_]+|^\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?[a-zA-Z]*/;
  var RE_ID = /^[A-Za-z_$][A-Za-z0-9_$]*/;
  var RE_OP = /^[+\-*/%=<>!&|^~?:]+/;
  var PUNCT = '{}()[];,.@#\\\\';

  function tokenizeGeneric(text, L) {
    var raw = text.split('\n');
    var out = new Array(raw.length);
    var state = null; /* { type, close, esc } for constructs spanning lines */

    for (var li = 0; li < raw.length; li++) {
      var line = raw[li];
      var toks = [];
      var i = 0, n = line.length;

      while (i < n) {
        var ch = line[i];

        /* continue an open block comment or multi-line string */
        if (state) {
          var ix = line.indexOf(state.close, i);
          if (ix === -1) {
            toks.push({ type: state.type, text: line.slice(i) });
            i = n;
          } else {
            toks.push({ type: state.type, text: line.slice(i, ix + state.close.length) });
            i = ix + state.close.length;
            state = null;
          }
          continue;
        }

        var rest = line.slice(i);

        var m = RE_WS.exec(rest);
        if (m) { toks.push({ type: 'ws', text: m[0] }); i += m[0].length; continue; }

        if (firstStartAt(line, i, L.lineComments)) {
          toks.push({ type: 'comment', text: line.slice(i) }); i = n; continue;
        }

        var bc = firstStartAt(line, i, L.blockComments);
        if (bc) {
          var e = line.indexOf(bc[1], i + bc[0].length);
          if (e === -1) {
            toks.push({ type: 'comment', text: line.slice(i) });
            i = n;
            state = { type: 'comment', close: bc[1], esc: false };
          } else {
            toks.push({ type: 'comment', text: line.slice(i, e + bc[1].length) });
            i = e + bc[1].length;
          }
          continue;
        }

        var ml = null;
        for (var s = 0; s < L.strings.length; s++) {
          if (L.strings[s].multiline && rest.startsWith(L.strings[s].open)) { ml = L.strings[s]; break; }
        }
        if (ml) {
          var ce = line.indexOf(ml.close, i + ml.open.length);
          if (ce === -1) {
            toks.push({ type: 'string', text: line.slice(i) });
            i = n;
            state = { type: 'string', close: ml.close, esc: ml.esc };
          } else {
            toks.push({ type: 'string', text: line.slice(i, ce + ml.close.length) });
            i = ce + ml.close.length;
          }
          continue;
        }

        var ss = null;
        for (var s2 = 0; s2 < L.strings.length; s2++) {
          if (!L.strings[s2].multiline && rest.startsWith(L.strings[s2].open)) { ss = L.strings[s2]; break; }
        }
        if (ss) {
          var j = i + ss.open.length;
          while (j < n) {
            if (ss.esc && line[j] === '\\') { j += 2; continue; }
            if (line.startsWith(ss.close, j)) { j += ss.close.length; break; }
            j++;
          }
          toks.push({ type: 'string', text: line.slice(i, j) }); i = j; continue;
        }

        var num = RE_NUM.exec(rest);
        if (num) { toks.push({ type: 'number', text: num[0] }); i += num[0].length; continue; }

        if (/[A-Za-z_$]/.test(ch)) {
          var id = RE_ID.exec(rest)[0];
          var after = line[i + id.length] || '';
          toks.push({ type: classifyIdent(L, id, after), text: id });
          i += id.length; continue;
        }

        var op = RE_OP.exec(rest);
        if (op) { toks.push({ type: 'operator', text: op[0] }); i += op[0].length; continue; }

        if (PUNCT.indexOf(ch) !== -1) { toks.push({ type: 'punct', text: ch }); i++; continue; }

        toks.push({ type: 'text', text: ch }); i++;
      }

      out[li] = toks.length ? toks : [{ type: 'ws', text: '' }];
    }

    return { lines: out, lang: L };
  }

  function classifyIdent(L, word, nextChar) {
    if (L._kw[word]) return 'keyword';
    if (L._co[word]) return 'constant';
    if (L._ty[word]) return 'type';
    if (L._bi[word]) return 'builtin';
    if (nextChar === '(') return 'fn';
    if (/^[A-Z][A-Za-z0-9_]*$/.test(word)) return 'type';
    return 'text';
  }

  function tokenize(text, langId) {
    var L = LANG[langId] || LANG.plain;
    var rawLines = text.split('\n');
    var result = new Array(rawLines.length);

    if (L.mdMode) {
      for (var i = 0; i < rawLines.length; i++) result[i] = mdLine(rawLines[i]);
      return { lines: result, lang: L };
    }

    if (L.yamlMode) {
      for (var y = 0; y < rawLines.length; y++) result[y] = yamlLine(rawLines[y]);
      return { lines: result, lang: L };
    }

    if (L.htmlMode) {
      var hs = { inComment: false };
      for (var h = 0; h < rawLines.length; h++) result[h] = htmlLine(rawLines[h], hs);
      return { lines: result, lang: L };
    }

    if (L.cssMode) {
      var inCc = false;
      for (var c = 0; c < rawLines.length; c++) {
        result[c] = cssLine(rawLines[c], inCc);
        if (result[c].some(function (tk) { return tk.type === 'comment'; })) {
          var open = (result[c].filter(function (tk) { return tk.type === 'comment'; })[0] || {}).text || '';
          inCc = open.indexOf('/*') !== -1 && open.indexOf('*/') === -1;
        }
      }
      return { lines: result, lang: L };
    }

    return tokenizeGeneric(text, L);

    return { lines: result, lang: L };
  }

  /* Column index of a character offset inside a token list (for typewriter clip). */
  function clipLine(tokens, chars) {
    var out = [], left = chars;
    for (var i = 0; i < tokens.length && left > 0; i++) {
      var tk = tokens[i];
      if (tk.type === 'group') { continue; }
      if (tk.text.length <= left) { out.push(tk); left -= tk.text.length; }
      else { out.push({ type: tk.type, text: tk.text.slice(0, left) }); left = 0; }
    }
    return out;
  }

  CM.LANG = LANG;
  CM.tokenize = tokenize;
  CM.clipLine = clipLine;
  CM.langLabel = function (id) { return (LANG[id] || LANG.plain).label; };
  CM.langIds = Object.keys(LANG);
})(window.CM = window.CM || {});