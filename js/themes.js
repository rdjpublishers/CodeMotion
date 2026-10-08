/* CodeMotion — theme registry.
   Every theme must expose the same keys. Colors are plain hex strings so they
   can be handed straight to the canvas 2D context. */
(function (CM) {
  'use strict';

  var THEMES = {
    dracula: {
      name: 'Dracula',
      bg: '#14141e', bg2: '#1b1b2b', panel: '#282a36', border: '#3b3d52',
      text: '#f8f8f2', muted: '#7d8195', accent: '#bd93f9', accent2: '#ff79c6',
      caret: '#ff79c6', selection: 'rgba(189,147,249,0.22)',
      keyword: '#ff79c6', string: '#f1fa8c', number: '#bd93f9',
      comment: '#6272a4', fn: '#50fa7b', builtin: '#8be9fd', type: '#8be9fd',
      operator: '#ff79c6', punct: '#f8f8f2', constant: '#bd93f9',
      grain: 0.03, vignette: 0.35
    },
    nord: {
      name: 'Nord',
      bg: '#2e3440', bg2: '#3b4252', panel: '#3b4252', border: '#4c566a',
      text: '#eceff4', muted: '#8a94a6', accent: '#88c0d0', accent2: '#a3be8c',
      caret: '#88c0d0', selection: 'rgba(136,192,208,0.22)',
      keyword: '#81a1c1', string: '#a3be8c', number: '#b48ead',
      comment: '#6b7280', fn: '#88c0d0', builtin: '#8fbcbb', type: '#8fbcbb',
      operator: '#81a1c1', punct: '#d8dee9', constant: '#b48ead',
      grain: 0.025, vignette: 0.3
    },
    monokai: {
      name: 'Monokai',
      bg: '#1c1d18', bg2: '#23241d', panel: '#272822', border: '#3e3d32',
      text: '#f8f8f2', muted: '#90908a', accent: '#a6e22e', accent2: '#fd971f',
      caret: '#fd971f', selection: 'rgba(166,226,46,0.2)',
      keyword: '#f92672', string: '#e6db74', number: '#ae81ff',
      comment: '#75715e', fn: '#a6e22e', builtin: '#66d9ef', type: '#66d9ef',
      operator: '#f92672', punct: '#f8f8f2', constant: '#ae81ff',
      grain: 0.03, vignette: 0.34
    },
    github: {
      name: 'GitHub Dark',
      bg: '#0d1117', bg2: '#010409', panel: '#161b22', border: '#30363d',
      text: '#e6edf3', muted: '#8b949e', accent: '#58a6ff', accent2: '#3fb950',
      caret: '#58a6ff', selection: 'rgba(56,139,253,0.25)',
      keyword: '#ff7b72', string: '#a5d6ff', number: '#79c0ff',
      comment: '#8b949e', fn: '#d2a8ff', builtin: '#ffa657', type: '#ffa657',
      operator: '#ff7b72', punct: '#e6edf3', constant: '#79c0ff',
      grain: 0.02, vignette: 0.28
    },
    solarized: {
      name: 'Solarized Dark',
      bg: '#002b36', bg2: '#073642', panel: '#073642', border: '#0d4a58',
      text: '#eee8d5', muted: '#839496', accent: '#b58900', accent2: '#cb4b16',
      caret: '#b58900', selection: 'rgba(181,137,0,0.2)',
      keyword: '#859900', string: '#2aa198', number: '#d33682',
      comment: '#586e75', fn: '#268bd2', builtin: '#cb4b16', type: '#b58900',
      operator: '#859900', punct: '#93a1a1', constant: '#d33682',
      grain: 0.028, vignette: 0.3
    },
    tokyo: {
      name: 'Tokyo Night',
      bg: '#1a1b26', bg2: '#16161e', panel: '#1f2335', border: '#2f334d',
      text: '#c0caf5', muted: '#787fa5', accent: '#7aa2f7', accent2: '#bb9af7',
      caret: '#7aa2f7', selection: 'rgba(122,162,247,0.22)',
      keyword: '#bb9af7', string: '#9ece6a', number: '#ff9e64',
      comment: '#565f89', fn: '#7aa2f7', builtin: '#2ac3de', type: '#e0af68',
      operator: '#89ddff', punct: '#c0caf5', constant: '#ff9e64',
      grain: 0.028, vignette: 0.32
    },
    onedark: {
      name: 'One Dark',
      bg: '#1b1d1e', bg2: '#212527', panel: '#282c34', border: '#3e4451',
      text: '#abb2bf', muted: '#7a828e', accent: '#61afef', accent2: '#98c379',
      caret: '#61afef', selection: 'rgba(97,175,239,0.22)',
      keyword: '#c678dd', string: '#98c379', number: '#d19a66',
      comment: '#5c6370', fn: '#61afef', builtin: '#e5c07b', type: '#e5c07b',
      operator: '#56b6c2', punct: '#abb2bf', constant: '#d19a66',
      grain: 0.03, vignette: 0.33
    },
    gruvbox: {
      name: 'Gruvbox Dark',
      bg: '#282828', bg2: '#32302f', panel: '#32302f', border: '#504945',
      text: '#ebdbb2', muted: '#a89984', accent: '#fabd2f', accent2: '#8ec07c',
      caret: '#fabd2f', selection: 'rgba(250,189,47,0.2)',
      keyword: '#fb4934', string: '#b8bb26', number: '#d3869b',
      comment: '#928374', fn: '#8ec07c', builtin: '#fe8019', type: '#fabd2f',
      operator: '#fb4934', punct: '#ebdbb2', constant: '#d3869b',
      grain: 0.035, vignette: 0.36
    },
    rosepine: {
      name: 'Rosé Pine',
      bg: '#191724', bg2: '#1f1d2e', panel: '#26233a', border: '#403d52',
      text: '#e0def4', muted: '#908caa', accent: '#c4a7e7', accent2: '#ebbcba',
      caret: '#ebbcba', selection: 'rgba(196,167,231,0.22)',
      keyword: '#31748f', string: '#f6c177', number: '#ebbcba',
      comment: '#6e6a86', fn: '#ebbcba', builtin: '#9ccfd8', type: '#c4a7e7',
      operator: '#908caa', punct: '#e0def4', constant: '#f6c177',
      grain: 0.026, vignette: 0.3
    },
    ayu: {
      name: 'Ayu Mirage',
      bg: '#1f2430', bg2: '#1a1f29', panel: '#24283b', border: '#3d4152',
      text: '#cccac2', muted: '#8a919f', accent: '#ffcc66', accent2: '#5ccfe6',
      caret: '#ffcc66', selection: 'rgba(255,204,102,0.2)',
      keyword: '#ff3333', string: '#aad94c', number: '#ffb454',
      comment: '#5c6773', fn: '#59c2ff', builtin: '#95e6cb', type: '#f4cd7c',
      operator: '#ff3333', punct: '#cccac2', constant: '#ffb454',
      grain: 0.03, vignette: 0.32
    },
    matrix: {
      name: 'Matrix',
      bg: '#000000', bg2: '#031104', panel: '#04140a', border: '#0d3b16',
      text: '#d6ffd6', muted: '#4f8f5c', accent: '#00ff41', accent2: '#7CFC00',
      caret: '#00ff41', selection: 'rgba(0,255,65,0.25)',
      keyword: '#00ff41', string: '#7fff7f', number: '#31ff7f',
      comment: '#2f6b3c', fn: '#00ff9c', builtin: '#00cc66', type: '#00ff9c',
      operator: '#00ff41', punct: '#d6ffd6', constant: '#31ff7f',
      grain: 0.05, vignette: 0.5
    },
    synthwave: {
      name: 'Synthwave',
      bg: '#1b1033', bg2: '#2a1a4a', panel: '#241546', border: '#452a78',
      text: '#f2e9ff', muted: '#a48cc9', accent: '#ff2e97', accent2: '#36f9f6',
      caret: '#ff2e97', selection: 'rgba(255,46,151,0.25)',
      keyword: '#ff2e97', string: '#ffd97d', number: '#36f9f6',
      comment: '#7a5fa6', fn: '#36f9f6', builtin: '#b967ff', type: '#f9f871',
      operator: '#ff8ad8', punct: '#f2e9ff', constant: '#36f9f6',
      grain: 0.045, vignette: 0.45
    },
    paper: {
      name: 'Paper Light',
      bg: '#f4f1ea', bg2: '#e9e5db', panel: '#fffdf8', border: '#d8d2c4',
      text: '#2c2a26', muted: '#8b8578', accent: '#b5541f', accent2: '#2a6f6b',
      caret: '#b5541f', selection: 'rgba(181,84,31,0.16)',
      keyword: '#a03325', string: '#2a6f4f', number: '#8a5a1f',
      comment: '#a49c8d', fn: '#2b5fa8', builtin: '#8a5a1f', type: '#6b4ba8',
      operator: '#a03325', punct: '#4a463e', constant: '#8a5a1f',
      grain: 0.02, vignette: 0.22
    }
  };

  /* Ordered so the STYLE dropdown reads nicely. */
  var ORDER = [
    'dracula', 'tokyo', 'github', 'monokai', 'nord', 'onedark',
    'solarized', 'gruvbox', 'rosepine', 'ayu', 'matrix', 'synthwave', 'paper'
  ];

  function get(id) {
    return THEMES[id] || THEMES.dracula;
  }

  CM.THEMES = THEMES;
  CM.THEME_ORDER = ORDER;
  CM.getTheme = get;
})(window.CM = window.CM || {});