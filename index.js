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
  console.error("❌ Missing keys in .env");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const cache = new Map();

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "🎬 *Movie Info Bot*\n\nMovie name send pannunga.\nExample: `Leo`",
    { parse_mode: "Markdown" }
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
      return bot.sendMessage(chatId, "❌ Movie not found. Spelling correct ah try pannu.");
    }

    const buttons = results.slice(0, 5).map((m) => [
      {
        text: `${m.Title} (${m.Year})`,
        callback_data: `movie_${m.imdbID}`
      }
    ]);

    await bot.sendMessage(chatId, "🎬 Select correct movie:", {
      reply_markup: { inline_keyboard: buttons }
    });
  } catch (err) {
    console.error(err.message);
    bot.sendMessage(chatId, "⚠️ Search error. API keys check pannu.");
  }
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (!data.startsWith("movie_")) return;

  const imdbId = data.replace("movie_", "");

  try {
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, "📦 Details prepare pannuren...");

    const movie = await getMovieByImdbId(imdbId);
    const watch = await getWatchSources(movie.Title, movie.Year);
    const trailer = await getTrailer(movie.Title, movie.Year);

    const whereText = formatWatch(watch);

    const caption =
`🎬 *${esc(movie.Title)}* (${esc(movie.Year)})

⭐ *IMDb:* ${esc(movie.imdbRating)}/10
🎭 *Genre:* ${esc(movie.Genre)}
🗣 *Language:* ${esc(movie.Language)}
⏱ *Runtime:* ${esc(movie.Runtime)}
🎬 *Director:* ${esc(movie.Director)}
👥 *Actors:* ${esc(movie.Actors)}
🏆 *Awards:* ${esc(movie.Awards)}

📺 *Where to Watch:*
${whereText}

📖 *Story:*
${esc(movie.Plot)}

🔗 *IMDb ID:* ${esc(movie.imdbID)}
${trailer ? `\n🎞 *Trailer:* ${trailer}` : ""}`;

    const keyboard = [];
    if (trailer) keyboard.push([{ text: "🎞 Watch Trailer", url: trailer }]);

    if (movie.Poster && movie.Poster !== "N/A") {
      await bot.sendPhoto(chatId, movie.Poster, {
        caption,
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard }
      });
    } else {
      await bot.sendMessage(chatId, caption, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: keyboard }
      });
    }
  } catch (err) {
    console.error(err.response?.data || err.message);
    bot.sendMessage(chatId, "⚠️ Details error. Try again da.");
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
    throw new Error("OMDb movie not found");
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

  cache.set(key, sources.data || []);
  return sources.data || [];
}

async function getTrailer(title, year) {
  try {
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
          apiKey: WATCHMODE_API_KEY,
          append_to_response: "episodes"
        },
        timeout: 15000
      }
    );

    return details.data.trailer || "";
  } catch {
    return "";
  }
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
    .slice(0, 8)
    .map((s, i) => {
      const link = s.url ? `\n   🔗 ${s.url}` : "";
      return `${i + 1}. ${esc(s.name)} — ${esc(s.type)}${link}`;
    })
    .join("\n");
}

function esc(value) {
  if (!value || value === "N/A") return "N/A";
  return String(value).replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

console.log("✅ Movie Info OTT Bot running...");
