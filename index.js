import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const {
  BOT_TOKEN,
  OMDB_API_KEY,
  WATCHMODE_API_KEY,
  WATCH_REGION = "LK"
} = process.env;

if (!BOT_TOKEN || !OMDB_API_KEY || !WATCHMODE_API_KEY) {
  console.error("Missing BOT_TOKEN / OMDB_API_KEY / WATCHMODE_API_KEY");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const cache = new Map();

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "🎬 Movie Info Bot\n\nMovie name send pannunga.\nExample: Leo"
  );
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text?.trim();

  if (!text || text.startsWith("/")) return;

  try {
    await bot.sendMessage(chatId, "🔎 Searching...");

    const results = await searchOmdb(text);

    if (!results.length) {
      return bot.sendMessage(chatId, "❌ Movie not found. Correct spelling try pannu.");
    }

    const buttons = results.slice(0, 5).map((m) => [
      {
        text: `${m.Title} (${m.Year})`.slice(0, 60),
        callback_data: `movie_${m.imdbID}`
      }
    ]);

    await bot.sendMessage(chatId, "🎬 Select correct movie:", {
      reply_markup: { inline_keyboard: buttons }
    });

  } catch (err) {
    console.error("SEARCH ERROR:", err.response?.data || err.message);
    bot.sendMessage(chatId, "⚠️ Search error. API keys check pannu.");
  }
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (!data || !data.startsWith("movie_")) return;

  const imdbId = data.replace("movie_", "");

  try {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, "📦 Details prepare pannuren...");

    const movie = await getMovieByImdbId(imdbId);

    let watch = [];
    let trailer = "";

    try {
      watch = await getWatchSources(movie.Title, movie.Year);
    } catch (e) {
      console.error("WATCHMODE SOURCES ERROR:", e.response?.data || e.message);
    }

    try {
      trailer = await getTrailer(movie.Title, movie.Year);
    } catch (e) {
      console.error("TRAILER ERROR:", e.response?.data || e.message);
    }

    const whereText = formatWatch(watch);

    const caption =
`🎬 ${clean(movie.Title)} (${clean(movie.Year)})

⭐ IMDb: ${clean(movie.imdbRating)}/10
🎭 Genre: ${clean(movie.Genre)}
🗣 Language: ${clean(movie.Language)}
⏱ Runtime: ${clean(movie.Runtime)}
🎬 Director: ${clean(movie.Director)}
👥 Actors: ${clean(movie.Actors)}
🏆 Awards: ${clean(movie.Awards)}

📺 Where to Watch:
${whereText}

📖 Story:
${clean(movie.Plot)}

🔗 IMDb ID: ${clean(movie.imdbID)}
${trailer ? `\n🎞 Trailer: ${trailer}` : ""}`;

    const keyboard = [];
    if (trailer) keyboard.push([{ text: "🎞 Watch Trailer", url: trailer }]);

    if (movie.Poster && movie.Poster !== "N/A") {
      await bot.sendPhoto(chatId, movie.Poster, {
        caption: caption.slice(0, 1024),
        reply_markup: { inline_keyboard: keyboard }
      });
    } else {
      await bot.sendMessage(chatId, caption.slice(0, 3900), {
        reply_markup: { inline_keyboard: keyboard }
      });
    }

  } catch (err) {
    console.error("DETAILS ERROR:", err.response?.data || err.message);
    bot.sendMessage(chatId, "⚠️ Details error. Try another movie da.");
  }
});

async function searchOmdb(title) {
  const key = `search_${title.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);

  const res = await axios.get("https://www.omdbapi.com/", {
    params: {
      apikey: OMDB_API_KEY,
      s: title,
      type: "movie"
    },
    timeout: 15000
  });

  const results = res.data.Search || [];
  cache.set(key, results);
  return results;
}

async function getMovieByImdbId(imdbId) {
  const key = `movie_${imdbId}`;
  if (cache.has(key)) return cache.get(key);

  const res = await axios.get("https://www.omdbapi.com/", {
    params: {
      apikey: OMDB_API_KEY,
      i: imdbId,
      plot: "short"
    },
    timeout: 15000
  });

  if (res.data.Response === "False") {
    throw new Error(res.data.Error || "OMDb movie not found");
  }

  cache.set(key, res.data);
  return res.data;
}

async function getWatchSources(title, year) {
  const key = `watch_${title}_${year}`;
  if (cache.has(key)) return cache.get(key);

  const search = await axios.get("https://api.watchmode.com/v1/search/", {
    params: {
      apiKey: WATCHMODE_API_KEY,
      search_field: "name",
      search_value: title,
      types: "movie"
    },
    timeout: 15000
  });

  const results = search.data.title_results || [];
  let best = results.find((r) => String(r.year) === String(year));
  if (!best) best = results[0];

  if (!best) return [];

  const sources = await axios.get(
    `https://api.watchmode.com/v1/title/${best.id}/sources/`,
    {
      params: {
        apiKey: WATCHMODE_API_KEY,
        regions: WATCH_REGION
      },
      timeout: 15000
    }
  );

  const data = sources.data || [];
  cache.set(key, data);
  return data;
}

async function getTrailer(title, year) {
  const search = await axios.get("https://api.watchmode.com/v1/search/", {
    params: {
      apiKey: WATCHMODE_API_KEY,
      search_field: "name",
      search_value: title,
      types: "movie"
    },
    timeout: 15000
  });

  const results = search.data.title_results || [];
  let best = results.find((r) => String(r.year) === String(year));
  if (!best) best = results[0];
  if (!best) return "";

  const details = await axios.get(
    `https://api.watchmode.com/v1/title/${best.id}/details/`,
    {
      params: {
        apiKey: WATCHMODE_API_KEY
      },
      timeout: 15000
    }
  );

  return details.data.trailer || "";
}

function formatWatch(sources = []) {
  if (!sources.length) {
    return "Not available / data not found in selected region.";
  }

  const map = new Map();

  for (const s of sources) {
    const name = s.name || s.source_name;
    const type = s.type || "stream";
    const url = s.web_url || s.url;

    if (!name) continue;

    const key = `${name}-${type}`;
    if (!map.has(key)) map.set(key, { name, type, url });
  }

  return [...map.values()]
    .slice(0, 6)
    .map((s, i) => {
      return `${i + 1}. ${clean(s.name)} — ${clean(s.type)}${s.url ? `\n   ${s.url}` : ""}`;
    })
    .join("\n");
}

function clean(value) {
  if (!value || value === "N/A") return "N/A";
  return String(value).replace(/\s+/g, " ").trim();
}

console.log("✅ Movie Info OTT Bot running...");
