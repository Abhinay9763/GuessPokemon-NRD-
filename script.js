// Who's That Pokémon? — PokéAPI
const $ = (id) => document.getElementById(id);
const GENS = { '1': 151, '2': 251, '3': 386, 'all': 1025 };

function getGen(id) {
  const limits = [151, 251, 386, 493, 649, 721, 809, 905];
  const idx = limits.findIndex((l) => id <= l);
  return idx === -1 ? 9 : idx + 1;
}

const fmt = (s) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function playTone(freq, dur = 0.15, type = 'sine') {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  } catch (e) {}
}

const state = {
  all: [], pool: [], target: null, guesses: [],
  streak: 0, count: 0, done: false, cry: null,
  sel: -1, matches: []
};
const cache = {};

async function getPokemon(query) {
  const q = String(query).trim().toLowerCase();
  if (cache[q]) return cache[q];

  const found = state.all.find((p) => p.id === Number(q) || p.name === q || p.clean === q.replace(/[^a-z0-9]/g, ''));
  const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${found ? found.name : q}`);
  if (!res.ok) throw new Error('Not found');
  const d = await res.json();

  const info = {
    id: d.id, name: d.name, title: fmt(d.name),
    types: d.types.map((t) => t.type.name),
    h: d.height / 10, w: d.weight / 10, gen: getGen(d.id),
    img: d.sprites.other?.['official-artwork']?.front_default || d.sprites.front_default,
    icon: d.sprites.front_default,
    cry: d.cries?.latest || `https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/${d.id}.ogg`
  };

  cache[q] = cache[d.id] = cache[d.name] = info;
  return info;
}

function compare(g, m) {
  const shared = g.types.filter((t) => m.types.includes(t));
  const gM = g.gen === m.gen;
  const hM = Math.abs(g.h - m.h) < 0.05;
  const wM = Math.abs(g.w - m.w) < 0.5;

  return {
    shared, gM, hM, wM,
    gen: `Gen ${g.gen} ${gM ? '(Same)' : m.gen > g.gen ? '(Newer ⬆)' : '(Older ⬇)'}`,
    h: `${g.h.toFixed(1)}m ${hM ? '(Equal)' : m.h > g.h ? '(Taller ⬆)' : '(Shorter ⬇)'}`,
    w: `${g.w.toFixed(1)}kg ${wM ? '(Equal)' : m.w > g.w ? '(Heavier ⬆)' : '(Lighter ⬇)'}`,
    note: `${shared.length ? `Shares <strong>${shared.map((t) => t.toUpperCase()).join(' & ')}</strong> type. ` : 'No shared types. '}${gM ? 'Same generation.' : ''}`
  };
}

function setStatus(html, ok = false) {
  $('statusMessage').className = `status-box ${ok ? 'success' : ''}`;
  $('statusMessage').innerHTML = html;
}

async function startRound() {
  const limit = GENS[$('genFilter').value] || 1025;
  state.pool = state.all.filter((p) => p.id <= limit);
  if (!state.pool.length) return;

  state.guesses = [];
  state.count = 0;
  state.done = false;
  $('guessCount').textContent = '0';
  $('cluesCounter').textContent = '0';
  $('cluesList').innerHTML = '';
  $('emptyClues').classList.remove('hidden');
  $('revealBanner').classList.add('hidden');
  $('nextBtn').classList.add('hidden');
  $('giveUpBtn').classList.remove('hidden');
  $('cryBtn').disabled = true;
  $('guessInput').value = '';
  $('guessInput').disabled = false;
  $('guessInput').focus();
  hideSuggest();

  $('pokemonImage').className = 'pokemon-img silhouette';
  $('pokemonImage').style.display = 'none';
  $('imageLoader').classList.add('active');
  setStatus('Guess the silhouette. Type a Pokémon name below.');

  const pick = state.pool[Math.floor(Math.random() * state.pool.length)];
  state.target = await getPokemon(pick.id);

  const img = new Image();
  img.src = state.target.img;
  img.onload = () => {
    $('pokemonImage').src = state.target.img;
    $('imageLoader').classList.remove('active');
    $('pokemonImage').style.display = 'block';
  };

  state.cry = new Audio(state.target.cry);
  state.cry.volume = 0.5;
}

function revealTarget(won, guess = null) {
  state.done = true;
  $('pokemonImage').className = 'pokemon-img revealed';
  $('revealedName').textContent = `${state.target.title}!`;
  $('revealBanner').classList.remove('hidden');
  $('cryBtn').disabled = false;
  $('giveUpBtn').classList.add('hidden');
  $('nextBtn').classList.remove('hidden');
  $('guessInput').disabled = true;

  if (state.cry) state.cry.play().catch(() => {});
  if (won) {
    state.streak++;
    [523, 659, 784].forEach((f, i) => setTimeout(() => playTone(f, 0.2), i * 70));
    setStatus(`🎉 Correct! It's <strong>${guess.title}</strong> in ${state.count} ${state.count === 1 ? 'try' : 'tries'}!`, true);
    addClue(guess, true);
  } else {
    state.streak = 0;
    setStatus(`It was <strong>${state.target.title}</strong> (#${state.target.id}).`);
  }
  $('streakCount').textContent = state.streak;
}

async function submitGuess(val) {
  if (state.done || !state.target) return;
  hideSuggest();
  $('guessInput').value = '';
  $('clearInputBtn').classList.add('hidden');

  let guess;
  try {
    guess = await getPokemon(val);
  } catch (e) {
    return setStatus(`Could not find "${val}". Pick from suggestions.`);
  }

  if (state.guesses.includes(guess.id)) return setStatus(`Already guessed <strong>${guess.title}</strong>.`);

  state.guesses.push(guess.id);
  $('guessCount').textContent = ++state.count;
  $('cluesCounter').textContent = state.count;
  $('emptyClues').classList.add('hidden');

  if (guess.id === state.target.id) return revealTarget(true, guess);

  playTone(200, 0.12, 'triangle');
  const diff = compare(guess, state.target);
  addClue(guess, false, diff);
  setStatus(diff.shared.length ? `Shared type: <strong>${diff.shared.join(', ').toUpperCase()}</strong>!` : `Not <strong>${guess.title}</strong>. Check clues below.`);
}

function addClue(p, match, diff = null) {
  const card = document.createElement('div');
  card.className = `clue-card ${match ? 'correct' : ''}`;
  const types = p.types.map((t) => `<span class="type-pill ${match || diff?.shared.includes(t) ? 'shared' : ''}">${t}</span>`).join(' ');

  card.innerHTML = `
    <div class="clue-header">
      <div class="clue-identity"><img class="clue-thumb" src="${p.icon}" alt=""><span class="clue-name">${p.title}</span><span class="clue-id">#${p.id}</span></div>
      <span class="clue-badge ${match ? 'badge-match' : diff?.shared.length ? 'badge-shared' : 'badge-none'}">${match ? 'Match' : diff?.shared.length ? `${diff.shared.join('/')} type` : 'No match'}</span>
    </div>
    <div class="metric-grid">
      <div class="metric-cell ${match || diff?.shared.length ? 'match' : ''}"><span class="metric-label">Types</span><div class="metric-val">${types}</div></div>
      <div class="metric-cell ${match || diff?.gM ? 'match' : ''}"><span class="metric-label">Gen</span><span class="metric-val">${match ? `Gen ${p.gen} ✓` : diff.gen}</span></div>
      <div class="metric-cell ${match || diff?.hM ? 'match' : ''}"><span class="metric-label">Height</span><span class="metric-val">${match ? `${p.h.toFixed(1)}m ✓` : diff.h}</span></div>
      <div class="metric-cell ${match || diff?.wM ? 'match' : ''}"><span class="metric-label">Weight</span><span class="metric-val">${match ? `${p.w.toFixed(1)}kg ✓` : diff.w}</span></div>
    </div>
    <div class="clue-note">${match ? 'Exact match!' : diff.note}</div>`;
  $('cluesList').prepend(card);
}

function hideSuggest() {
  $('suggestionList').classList.add('hidden');
  $('suggestionList').innerHTML = '';
  state.sel = -1;
  state.matches = [];
}

function onInput(e) {
  const q = e.target.value.trim().toLowerCase();
  $('clearInputBtn').classList.toggle('hidden', !q);
  if (!q) return hideSuggest();

  const clean = q.replace(/[^a-z0-9]/g, '');
  state.matches = state.pool.filter((p) => p.clean.includes(clean) || String(p.id) === q).slice(0, 7);

  $('suggestionList').innerHTML = state.matches.length
    ? state.matches.map((p) => `
      <li class="suggestion-item" data-name="${p.name}">
        <div class="suggestion-left"><img class="suggestion-thumb" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${p.id}.png" alt=""><span class="suggestion-name">${p.title}</span></div>
        <span class="suggestion-id">#${p.id}</span>
      </li>`).join('')
    : '<li class="suggestion-empty">No Pokémon found</li>';
  $('suggestionList').classList.remove('hidden');
  state.sel = -1;
}

function onKey(e) {
  const list = $('suggestionList'), items = list.querySelectorAll('.suggestion-item');
  const open = !list.classList.contains('hidden') && items.length > 0;

  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && open) {
    e.preventDefault();
    state.sel = (state.sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((it, i) => it.classList.toggle('active', i === state.sel));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (open && state.sel >= 0) submitGuess(items[state.sel].dataset.name);
    else if (open && state.matches.length) submitGuess(state.matches[0].name);
    else if ($('guessInput').value.trim()) submitGuess($('guessInput').value.trim());
  } else if (e.key === 'Escape') hideSuggest();
}

document.addEventListener('DOMContentLoaded', async () => {
  $('guessInput').oninput = onInput;
  $('guessInput').onkeydown = onKey;
  $('clearInputBtn').onclick = () => { $('guessInput').value = ''; $('clearInputBtn').classList.add('hidden'); hideSuggest(); $('guessInput').focus(); };
  $('suggestionList').onclick = (e) => { const it = e.target.closest('.suggestion-item'); if (it) submitGuess(it.dataset.name); };
  document.onclick = (e) => { if (!$('guessInput').contains(e.target) && !$('suggestionList').contains(e.target)) hideSuggest(); };
  $('cryBtn').onclick = () => state.cry?.play().catch(() => {});
  $('giveUpBtn').onclick = () => !state.done && revealTarget(false);
  $('nextBtn').onclick = startRound;
  $('genFilter').onchange = startRound;

  const res = await fetch('https://pokeapi.co/api/v2/pokemon?limit=1025');
  const data = await res.json();
  state.all = data.results.map((p, i) => ({
    id: i + 1, name: p.name, title: fmt(p.name), clean: p.name.replace(/[^a-z0-9]/g, '')
  }));
  startRound();
});
