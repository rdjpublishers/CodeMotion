/* CodeMotion — starter snippets for the "Load example…" menu. */
(function (CM) {
  'use strict';

  var EXAMPLES = [
    {
      label: 'Python — functional toolkit',
      language: 'python',
      theme: 'dracula',
      code: [
        '# A small functional toolkit',
        'def pluck_deep(key):',
        '    """Build a getter from a dotted path."""',
        '    return lambda obj: reduce(',
        '        lambda acc, k: acc[k],',
        '        key.split("."), obj)',
        '',
        'def compose(*fns):',
        '    return lambda res: reduce(',
        '        lambda acc, fn: fn(acc), fns, res)',
        '',
        'def unfold(f, seed):',
        '    """Build a list by repeatedly applying f."""',
        '    acc = [seed]',
        '    while True:',
        '        result = f(seed)',
        '        if result == seed:',
        '            return acc',
        '        acc.append(result)',
        '        seed = result'
      ].join('\n')
    },
    {
      label: 'JavaScript — fetch with retry',
      language: 'javascript',
      theme: 'tokyo',
      code: [
        '/** Retry a promise until it resolves. */',
        'export async function retry(fn, { attempts = 3, delay = 250 } = {}) {',
        '  let lastError;',
        '',
        '  for (let i = 0; i < attempts; i++) {',
        '    try {',
        '      return await fn(i);',
        '    } catch (error) {',
        '      lastError = error;',
        '      await sleep(delay * 2 ** i);',
        '    }',
        '  }',
        '',
        '  throw lastError;',
        '}',
        '',
        'const sleep = (ms) => new Promise((r) => setTimeout(r, ms));'
      ].join('\n')
    },
    {
      label: 'TypeScript — result type',
      language: 'typescript',
      theme: 'github',
      code: [
        'type Result<T, E = Error> =',
        '  | { ok: true; value: T }',
        '  | { ok: false; error: E };',
        '',
        'async function safe<T>(fn: () => Promise<T>): Promise<Result<T>> {',
        '  try {',
        '    const value = await fn();',
        '    return { ok: true, value };',
        '  } catch (error) {',
        '    return { ok: false, error: error as Error };',
        '  }',
        '}'
      ].join('\n')
    },
    {
      label: 'React — useDebounced hook',
      language: 'javascript',
      theme: 'onedark',
      code: [
        'import { useEffect, useState } from "react";',
        '',
        'export function useDebounced(value, ms = 300) {',
        '  const [debounced, setDebounced] = useState(value);',
        '',
        '  useEffect(() => {',
        '    const timer = setTimeout(() => setDebounced(value), ms);',
        '    return () => clearTimeout(timer);',
        '  }, [value, ms]);',
        '',
        '  return debounced;',
        '}'
      ].join('\n')
    },
    {
      label: 'Go — HTTP server',
      language: 'go',
      theme: 'nord',
      code: [
        'package main',
        '',
        'import (',
        '\t"fmt"',
        '\t"log"',
        '\t"net/http"',
        ')',
        '',
        'func main() {',
        '\tmux := http.NewServeMux()',
        '\tmux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {',
        '\t\tfmt.Fprintln(w, "ok")',
        '\t})',
        '',
        '\tlog.Println("listening on :8080")',
        '\tlog.Fatal(http.ListenAndServe(":8080", mux))',
        '}'
      ].join('\n')
    },
    {
      label: 'Rust — iterator pipeline',
      language: 'rust',
      theme: 'gruvbox',
      code: [
        '#[derive(Debug, Clone)]',
        'struct Summary {',
        '    total: u32,',
        '    words: usize,',
        '}',
        '',
        'fn summarize(text: &str) -> Summary {',
        '    let words: Vec<&str> = text.split_whitespace().collect();',
        '    Summary {',
        '        total: text.chars().filter(|c| c.is_alphabetic()).count() as u32,',
        '        words: words.len(),',
        '    }',
        '}'
      ].join('\n')
    },
    {
      label: 'HTML — landing section',
      language: 'html',
      theme: 'synthwave',
      code: [
        '<section class="hero">',
        '  <h1>Ship it faster</h1>',
        '  <p>Everything you need, nothing you don\'t.</p>',
        '  <a class="cta" href="/start">Get started</a>',
        '</section>'
      ].join('\n')
    },
    {
      label: 'CSS — card system',
      language: 'css',
      theme: 'rosepine',
      code: [
        '.card {',
        '  display: grid;',
        '  gap: 12px;',
        '  padding: 20px;',
        '  border-radius: 14px;',
        '  background: #26233a;',
        '  box-shadow: 0 8px 24px rgba(0, 0, 0, .35);',
        '}',
        '',
        '.card:hover {',
        '  transform: translateY(-2px);',
        '}'
      ].join('\n')
    },
    {
      label: 'SQL — monthly report',
      language: 'sql',
      theme: 'monokai',
      code: [
        'SELECT',
        '    DATE_TRUNC(\'month\', created_at) AS month,',
        '    COUNT(*)                AS orders,',
        '    SUM(total_cents)        AS revenue',
        'FROM orders',
        'WHERE created_at >= NOW() - INTERVAL \'12 months\'',
        'GROUP BY 1',
        'ORDER BY 1 DESC;'
      ].join('\n')
    },
    {
      label: 'Bash — backup script',
      language: 'bash',
      theme: 'ayu',
      code: [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        '',
        'STAMP=$(date +%Y%m%d-%H%M)',
        'DEST="backups/$STAMP"',
        '',
        'mkdir -p "$DEST"',
        'tar -czf "$DEST/data.tgz" ./data',
        'echo "backup written to $DEST"'
      ].join('\n')
    }
  ];

  CM.EXAMPLES = EXAMPLES;
})(window.CM = window.CM || {});