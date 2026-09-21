import express from "express";
import path from "path";
import dotenv from "dotenv";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

// True inside a serverless function (Vercel sets VERCEL=1 automatically;
// Netlify gets SERVERLESS=1 via netlify.toml [functions.environment]).
// In serverless mode we skip static frontend serving and never call app.listen().
// In serverless mode we skip static frontend serving and never call app.listen().
// (No __dirname needed: serverless mode skips static file serving,
// and the standalone server resolves paths from process.cwd().)

const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.SERVERLESS);

// State variables for self-healing search grounding
let isSearchGroundingAvailable = true;
let searchGroundingUnavailableUntil = 0;

// Shared helper function to scrape Pakistan Post live tracking info safely and reliably
async function handlePakPostTrack(trackingId: string) {
  const normalizedId = trackingId.toUpperCase().trim();
  const trackingUrl = `https://ep.gov.pk/track.asp?trackid=${normalizedId}`;
  const scrapeUrl = `https://ep.gov.pk/emtts/EPTrack_Live.aspx?ArticleIDz=${normalizedId}`;
  
  let events: any[] = [];
  let currentStatus = "معلومات میسر نہیں";
  let location = "نامعلوم";
  let lastUpdate = "آج";
  let bookingOffice = "";
  let deliveryOffice = "";

  try {
    const response = await axios.get(scrapeUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "text/html"
      },
      timeout: 20000
    });

    if (!response.data) {
       throw new Error("Empty response from server");
    }

    const $ = cheerio.load(response.data);
    
    bookingOffice = $("#LblBookingOffice").text().trim();
    deliveryOffice = $("#LblDeliveryOffice").text().trim();
    
    if (bookingOffice || deliveryOffice) {
      events.push({
        date: "بنیادی تفصیل",
        location: `منزل: ${deliveryOffice || 'نامعلوم'}`,
        status: `بکنگ آفس: ${bookingOffice || 'نامعلوم'}`
      });
    }

    let isMoneyOrderTable = false;
    let parcelEvents: any[] = [];
    let mosEvents: any[] = [];
    
    $(".simple-table").each((idx, table) => {
       if (idx > 0) {
         isMoneyOrderTable = true;
       } else {
         isMoneyOrderTable = false;
       }
       
       let currentDate = "آج";
       $(table).find("tr").each((_, tr) => {
          const dateHeading = $(tr).find(".date-heading").text().trim();
          if (dateHeading) {
             currentDate = dateHeading;
          } else {
             const timeCell = $(tr).find(".time").text().trim();
             if (timeCell) {
               const cells = $(tr).find("td");
               if (cells.length >= 4) {
                 const loc = $(cells[2]).text().trim();
                 const stat = $(cells[3]).text().trim();
                 
                 if (stat) {
                   const eventObj = {
                     date: `${currentDate} (${timeCell})`,
                     location: loc || "پاکستان پوسٹ",
                     status: stat
                   };
                   if (isMoneyOrderTable) {
                     mosEvents.push(eventObj);
                   } else {
                     parcelEvents.push(eventObj);
                   }
                 }
               }
             }
          }
       });
    });

    let finalEvents = [...parcelEvents, ...mosEvents];
    events = [...events, ...finalEvents];

    if (events.length > 0) {
      const filteredEvents = events.filter((ev, index, self) => 
         ev.status.length > 1 && 
         self.findIndex(e => e.status === ev.status && e.date === ev.date) === index
      );

      if (filteredEvents.length > 0) {
        const lastParcelEvent = parcelEvents.length > 0 ? parcelEvents[parcelEvents.length - 1] : null;
        const lastMosEvent = mosEvents.length > 0 ? mosEvents[mosEvents.length - 1] : null;
        
        if (lastMosEvent) {
           currentStatus = lastMosEvent.status; 
           location = lastMosEvent.location;
           lastUpdate = lastMosEvent.date;
           currentStatus = `[Money Order] ${currentStatus}`;
        } else if (lastParcelEvent) {
           currentStatus = lastParcelEvent.status;
           location = lastParcelEvent.location;
           lastUpdate = lastParcelEvent.date;
        } else {
           currentStatus = filteredEvents[filteredEvents.length - 1].status;
           location = filteredEvents[filteredEvents.length - 1].location;
           lastUpdate = filteredEvents[filteredEvents.length - 1].date;
        }
        
        events = filteredEvents.reverse(); 
      }
    } 
    
    if (events.length === 0 || (events.length === 1 && events[0].date === "بنیادی تفصیل" && !bookingOffice && !deliveryOffice)) {
       currentStatus = "ریکارڈ نہیں ملا (ID چیک کریں)";
       events = [];
    }
  } catch (scrapeError: any) {
    console.error("PakPost Scraper error:", scrapeError.message);
    currentStatus = "سرور مصروف ہے (ویب سائٹ دیکھیں)";
    events = [{ date: "آج", location: "سسٹم", status: "سرور جواب نہیں دے رہا، براہ کرم 'ویب سائٹ پر دیکھیں' والا بٹن دبائیں" }];
  }

  return {
    success: true,
    courier: "pakpost",
    trackingId: normalizedId,
    trackingUrl,
    status: currentStatus,
    lastUpdate,
    location,
    events: events.length > 0 ? events : null,
    bookingOffice,
    deliveryOffice
  };
}

// In-memory cache for tracked parcels to prevent excessive API usage and bypass quota exhaustion
const trackingCache = new Map<string, { data: any, expiresAt: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // Cache tracking lookup for 15 minutes to save quota

// Direct scraping for Leopards Courier to prevent fake/mock data reports
async function handleLeopardsTrack(trackingId: string) {
  const normalizedId = trackingId.toUpperCase().trim();
  const trackingUrl = `https://pk.leopardscourier.com/shipment_tracking_view?cn_number=${normalizedId}`;
  
  // Check in-memory Cache to see if we can serve immediately
  const cacheKey = `leopards:${normalizedId}`;
  const cached = trackingCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`Using cached Leopards tracking data for ID: ${normalizedId}`);
    return cached.data;
  }

  let events: any[] = [];
  let currentStatus = "معلومات میسر نہیں";
  let location = "پاکستان";
  let lastUpdate = "آج";

  try {
    const response = await axios.get(trackingUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Referer": "https://pk.leopardscourier.com/"
      },
      timeout: 15000
    });

    if (!response.data) {
       throw new Error("Empty response from server");
    }

    const $ = cheerio.load(response.data);
    const htmlText = response.data;
    
    // Check if invalid or record not found
    const notFound = htmlText.includes("invalid") || 
                     htmlText.includes("record not found") || 
                     htmlText.includes("No shipment data found") ||
                     htmlText.includes("appeared to be invalid");

    if (notFound) {
      const resultObj = {
        success: true,
        courier: "leopards",
        trackingId: normalizedId,
        trackingUrl,
        status: "ریکارڈ دستیاب نہیں (آئی ڈی درست کریں)",
        lastUpdate: "نامعلوم",
        location: "پاکستان",
        events: []
      };
      // Cache the negative lookup for 5 minutes instead of 15 to allow correct registrations
      trackingCache.set(cacheKey, { data: resultObj, expiresAt: Date.now() + 5 * 60 * 1000 });
      return resultObj;
    }

    // Parse tracking table history
    let milestoneTable: any = null;

    $("table").each((idx, table) => {
       const text = $(table).text().toLowerCase();
       if (text.includes("date") || text.includes("activity") || text.includes("status") || text.includes("scan") || text.includes("remarks")) {
          milestoneTable = table;
       }
    });

    if (!milestoneTable && $("table").length > 0) {
      milestoneTable = $("table").get($("table").length > 1 ? 1 : 0);
    }

    if (milestoneTable) {
      const rows = $(milestoneTable).find("tr");
      rows.each((rIdx, tr) => {
         if ($(tr).find("th").length > 0) return;
         
         const cells = $(tr).find("td");
         if (cells.length >= 2) {
            const rowData = cells.map((_, td) => $(td).text().trim().replace(/\s+/g, ' ')).get();
            
            let dateVal = rowData[0] || "";
            let locVal = rowData[1] || "";
            let statVal = rowData[2] || "";

            if (rowData.length === 2) {
              dateVal = rowData[0];
              statVal = rowData[1];
              locVal = "پاکستان";
            } else if (rowData.length >= 4) {
              dateVal = rowData[0];
              locVal = rowData[1];
              statVal = rowData[2] + (rowData[3] ? ` - ${rowData[3]}` : "");
            }

            if (dateVal && !dateVal.toLowerCase().includes("date") && !dateVal.toLowerCase().includes("query") && !dateVal.toLowerCase().includes("no shipment")) {
              events.push({
                date: dateVal,
                location: locVal || "پاکستان",
                status: statVal
              });
            }
         }
      });
    }

    if (events.length > 0) {
       // Grab the latest event for current state
       const latestEvent = events[0];
       currentStatus = latestEvent.status;
       location = latestEvent.location;
       lastUpdate = latestEvent.date;
    } else {
       currentStatus = "بک ہو گیا ہے (لائیو اپڈیٹ انتظار کریں)";
       lastUpdate = "آج";
       location = "پاکستان";
       events = [{ date: "آج", location: "لیپرڈ", status: "پارسل سسٹم میں بک ہو گیا ہے اور جلد روانہ کیا جائے گا" }];
    }

  } catch (error: any) {
    console.error("Leopards scraping failed:", error.message || error);
    currentStatus = "سرور مصروف ہے (ویب سائٹ دیکھیں)";
    events = [{ date: "آج", location: "لیپرڈ", status: "سرور جواب نہیں دے رہا، براہ کرم 'ویب سائٹ پر دیکھیں' والا بٹن دبائیں" }];
  }

  const finalResult = {
    success: true,
    courier: "leopards",
    trackingId: normalizedId,
    trackingUrl,
    status: currentStatus,
    lastUpdate,
    location,
    events: events.length > 0 ? events : null
  };

  trackingCache.set(cacheKey, { data: finalResult, expiresAt: Date.now() + CACHE_TTL_MS });
  return finalResult;
}

// Shared helper function to search and parse other couriers (leopards, tcs) with live search grounding
async function handleSearchGroundedTrack(courier: string, trackingId: string) {
  const normalizedId = trackingId.toUpperCase().trim();
  const courierName = courier === "leopards" ? "Leopards Courier" : "TCS Courier";
  const trackingUrl = courier === "leopards" 
    ? `https://www.leopardscourier.com/track/${normalizedId}`
    : `https://www.tcs.com.pk/tracking?tracking_number=${normalizedId}`;

  // 1. Check in-memory Cache to see if we can serve immediately without any API hit
  const cacheKey = `${courier}:${normalizedId}`;
  const cached = trackingCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`Using cached tracking data for ${courierName} ID: ${normalizedId}`);
    return cached.data;
  }

  // When live tracking is unavailable we must NOT invent milestones.
  // Return an honest "not available" result so the caller shows the
  // "no live info" message instead of fake hub names and old dates.
  const getFallbackData = () => {
    return {
      success: false,
      courier,
      trackingId: normalizedId,
      trackingUrl,
      status: "لائیو معلومات دستیاب نہیں",
      lastUpdate: "نامعلوم",
      location: "نامعلوم",
      events: []
    };
  };

  // 2. Check if Search Grounding is temporarily suspended due to 429 quota exhaustion or other issues
  if (!isSearchGroundingAvailable && Date.now() < searchGroundingUnavailableUntil) {
    console.log(`Live Search Grounding is temporarily suspended due to quota limits. Bypassing live API and using fallback for ${courierName} ID: ${normalizedId}`);
    return getFallbackData();
  }

  if (Date.now() >= searchGroundingUnavailableUntil) {
    isSearchGroundingAvailable = true;
  }

  try {
    if (!process.env.GEMINI_API_KEY) {
       throw new Error("Gemini API key is missing");
    }
    
    const ai = new GoogleGenAI({ 
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });

    console.log(`Live Search Grounding: tracking ${courierName} parcel ID: ${normalizedId}...`);
    
    const prompt = `Search live Google web results and extract the absolute latest tracking status, history, milestones, and location for the tracking ID: "${normalizedId}" shipped via "${courierName}" in Pakistan.
Search on sites like official portals, aftership, 17track, or pkge.net.

Output in EXACTLY the following JSON format:
{
  "status": "A short 1-4 word status summary in Urdu (e.g. 'بک ہو چکا ہے' if booked, 'ٹرانزٹ میں ہے' if in transit/dispatched, 'ڈیلیوری کے لیے روانہ' if out for delivery, 'ڈیلیور ہو گیا ہے' if delivered, 'واپس بھیج دیا گیا' if returned)",
  "lastUpdate": "Human readable date/time (e.g. '12 June 2026' or 'آج 10:15 AM')",
  "location": "Current city/location (e.g. 'کراچی' or 'لاہور' or 'پاکستان')",
  "events": [
    {
      "date": "Milestone date and time (e.g., '12 June 2026 (02:30 PM)')",
      "location": "Milestone city or office (e.g. 'کراچی ہب')",
      "status": "Milestone status text in Urdu (e.g., 'آرڈر موصول ہو گیا ہے', 'کراچی روانہ کر دیا گیا')"
    }
  ]
}

Ensure all status notes and tracking milestone event text are in Urdu. If no tracking information is found or the search fails to get real data, return:
{
  "status": "معلومات دستیاب نہیں (ID چیک کریں)",
  "lastUpdate": "نامعلوم",
  "location": "پاکستان",
  "events": []
}
Do NOT output any prefix, suffix, markdown blocks (like \`\`\`json) or conversational text. Return only the raw JSON string.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json"
      }
    });

    if (response && response.text) {
      const parsedText = response.text.trim();
      const parsed = JSON.parse(parsedText);
      
      if (parsed.status && parsed.status !== "معلومات دستیاب نہیں (ID چیک کریں)" && parsed.status !== "نامعلوم") {
        const result = {
          success: true,
          courier,
          trackingId: normalizedId,
          trackingUrl,
          status: parsed.status,
          lastUpdate: parsed.lastUpdate || "آج",
          location: parsed.location || "پاکستان",
          events: parsed.events && parsed.events.length > 0 ? parsed.events : null
        };
        // Store successful lookup in cache
        trackingCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
        return result;
      }
    }
  } catch (error: any) {
    let errorString = "";
    try {
      errorString = typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error);
    } catch (e) {
      errorString = String(error);
    }
    const errMsg = error.message || errorString;
    console.error(`Grounded track error for ${courier} ${normalizedId}:`, errMsg);
    
    // Check if error is related to quota or rate-limiting
    const isQuotaError = errMsg.includes("quota") || 
                         errMsg.includes("429") || 
                         errMsg.includes("RESOURCE_EXHAUSTED") || 
                         errMsg.includes("rate-limits") || 
                         errMsg.includes("503") || 
                         errMsg.includes("UNAVAILABLE") ||
                         errorString.includes("429") ||
                         errorString.includes("RESOURCE_EXHAUSTED");
                         
    if (isQuotaError) {
      isSearchGroundingAvailable = false;
      searchGroundingUnavailableUntil = Date.now() + 5 * 60 * 1000; // suspend for 5 minutes
      console.warn(`Disabling Search Grounding for 5 minutes due to tracking request error: Quota limits reached.`);
    }
  }

  // Return fallback and cache it so we don't spam the API for this key
  const fallbackResult = getFallbackData();
  trackingCache.set(cacheKey, { data: fallbackResult, expiresAt: Date.now() + CACHE_TTL_MS });
  return fallbackResult;
}

export async function createApp() {
  const app = express();

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Health check (for hosting platforms)
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Track Parcel Proxy (To avoid CORS issues and scrape real data)
  app.get("/api/track/:courier/:trackingId", async (req, res) => {
    const { courier, trackingId } = req.params;
    
    try {
      if (courier === "pakpost") {
        const trackResult = await handlePakPostTrack(trackingId);
        return res.json(trackResult);
      } else if (courier === "leopards") {
        const trackResult = await handleLeopardsTrack(trackingId);
        return res.json(trackResult);
      } else if (courier === "tcs") {
        const trackResult = await handleSearchGroundedTrack(courier, trackingId);
        return res.json(trackResult);
      }

      res.status(400).json({ error: "Unsupported courier" });
    } catch (error) {
      console.error("Tracking API Error:", error);
      res.status(500).json({ error: "Tracking failed" });
    }
  });

  // Chat API
  app.post("/api/chat", async (req, res) => {
    let autoScrapedDetails = "";
    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("Gemini API key is missing on the server");
      }
      
      const { message, history, context } = req.body;
      const ai = new GoogleGenAI({ 
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      const formattedHistory = history.map((m: any) => ({
        role: m.role,
        parts: [{ text: m.text }]
      }));

      // Robust extraction of tracking code matching standard formats:
      // 1. PakPost: CP123456789PK
      // 2. Leopards/TCS: Alphanumeric (e.g. KI7536838586) or 10-15 digits
      const trackingMatch = message.toUpperCase().match(/[A-Z]{2}\d{9}[A-Z]{2}/) || 
                            message.toUpperCase().match(/\bKI\d{8,12}\b/) ||
                            message.match(/\b\d{10,15}\b/);
      let trackingIdToScrape = trackingMatch ? trackingMatch[0] : null;

      if (!trackingIdToScrape && context?.orders) {
        // Search current database orders context to match a username or a phone number
        for (const order of context.orders) {
          if (order.customerName && message.toLowerCase().includes(order.customerName.toLowerCase())) {
            if (order.trackingNumber) {
              trackingIdToScrape = order.trackingNumber;
              break;
            }
          }
          if (order.customerPhone && message.includes(order.customerPhone)) {
            if (order.trackingNumber) {
              trackingIdToScrape = order.trackingNumber;
              break;
            }
          }
        }
      }

      autoScrapedDetails = "";
      if (trackingIdToScrape) {
        try {
          const isLpd = trackingIdToScrape.toUpperCase().startsWith("KI");
          const isPakPost = /[A-Z]{2}\d{9}[A-Z]{2}/.test(trackingIdToScrape.toUpperCase());
          
          let trackResult;
          let courierName = "Pakistan Post";
          if (isLpd) {
            console.log(`Chat API Auto-Scraping: Checking Leopards tracking for ${trackingIdToScrape}...`);
            trackResult = await handleSearchGroundedTrack("leopards", trackingIdToScrape);
            courierName = "Leopards Courier";
          } else if (isPakPost) {
            console.log(`Chat API Auto-Scraping: Checking PakPost tracking for ${trackingIdToScrape}...`);
            trackResult = await handlePakPostTrack(trackingIdToScrape);
            courierName = "Pakistan Post";
          } else {
            console.log(`Chat API Auto-Scraping: Checking general tracking for ${trackingIdToScrape}...`);
            trackResult = await handleSearchGroundedTrack("tcs", trackingIdToScrape);
            courierName = "TCS Courier";
          }

          if (trackResult && trackResult.events && trackResult.events.length > 0) {
            const eventsText = trackResult.events.map((e: any) => `| ${e.date} | ${e.location} | ${e.status} |`).join("\n");
            autoScrapedDetails = `
---
[LIVE ${courierName.toUpperCase()} WEB TRACKING RESULTS]
Tracking ID: ${trackingIdToScrape}
Current Status: ${trackResult.status}
Location: ${trackResult.location}
Last Updated: ${trackResult.lastUpdate}

Live Step-by-Step Milestones:
| Date / Time | Office Location | Action / Status Description |
|---|---|---|
${eventsText}
---
The above is the absolute, latest real-time physical parcel record retrieved from the official tracking server right now. Use these precise figures as the single source of truth to answer the user! Describe their parcel status bilingual (in both Urdu and English), and display the history milestones exactly as a nice Markdown table.
`;
          } else {
            autoScrapedDetails = `
---
[LIVE ${courierName.toUpperCase()} WEB TRACKING RESULTS]
Tracking ID: ${trackingIdToScrape}
Status: Currently no tracking events were returned from the live web server. The ID is either new, invalid, or needs up to 24 hours to registered on the system.
---
`;
          }
        } catch (scrapErr: any) {
          console.error("Chat API: Auto web tracking failed", scrapErr.message || scrapErr);
        }
      }

      const systemInstructionBase = `You are an AI assistant for a logistics tracking application for Pakistan Post. You can help users manage their inventory, orders, and track parcels.

Here is the current state of the user's data:
---
[Products]
${JSON.stringify(context?.products || [])}

[Orders]
${JSON.stringify(context?.orders || [])}
---

${autoScrapedDetails}

CRITICAL INSTRUCTION FOR CALCULATING ACCOUNTS (حساب کتاب اور قیمت خرید کا حساب):
Whenever the user lists products/items with quantities and asks you to calculate their total/accounts ("میرا حساب کرو" or "اس کا حساب کرو"), you MUST do the following:
1. Search the [Products] array provided above to match the user's referenced names (allowing substring or phonetic matching in both Urdu and English, e.g. "پراڈکٹ اے", "کمپیوٹر" or "Product A").
2. Retrieve each matching item's "costPrice" (قیمت خرید) and "sellingPrice" (قیمت فروخت) from the database context.
3. Perform mathematically accurate calculations:
   - Calculate unit cost price (قیمت خرید) and unit selling price (قیمت فروخت).
   - Calculate the total cost price (کل قیمت خرید) for each specified quantity.
   - Calculate the total selling price (کل قیمت فروخت) for each specified quantity.
   - Calculate the potential total profit (کل متوقع منافع) = [Total Selling Price] - [Total Cost Price].
4. Output a beautiful Markdown table in both Urdu and English representing this financial breakdown, clearly showing both procurement/cost values and end-sale values so the user gets the correct calculation (درست حساب).
5. Add helpful feedback on inventory level, warnings if specified quantities exceed available stock, and summaries of total profit. If a product is not found in the inventory, politely indicate that and ask for its cost/sale prices.

If the user asks questions about their overall profit, sales, customers, stock, or specific orders, use the [Products] and [Orders] data provided above to answer them precisely. If they ask about a specific person, search for their name or address in the Orders data. Calculate sums and counts accurately when asked about profit or monthly metrics.

Whenever a user enters a tracking number (e.g., CP123456789PK or RB123456789PK), present any live tracking results provided above. Use both Urdu and English for better clarity.
Extract and present the following information:
- Current Status (e.g., Booked, Dispatched, Arrived at Office, Delivered).
- Current Location of the parcel.
- Date and Time of the last update.
Language Policy: Provide the update in both Urdu and English for better clarity.
Formatting: Use a Markdown table for the tracking history if multiple steps are found.
Error Handling: If no data is found, politely ask the user to double-check the tracking ID or mention that the data might take 24 hours to appear in the system.
Tone: Professional, efficient, and supportive.`;

      // Reset grounding toggle if 5 minutes have elapsed since the last 429/503 fallback
      if (!isSearchGroundingAvailable && Date.now() > searchGroundingUnavailableUntil) {
        isSearchGroundingAvailable = true;
        console.log("Chat API: Restoring trial runs of Google Search Grounding.");
      }

      let response;
      let usedSearch = false;

      if (isSearchGroundingAvailable) {
        try {
          console.log("Chat API: Trying primary model gemini-3.6-flash with Google Search...");
          const chat = ai.chats.create({
            model: "gemini-3.6-flash",
            history: formattedHistory,
            config: {
              systemInstruction: systemInstructionBase,
              tools: [{ googleSearch: {} }]
            }
          });
          response = await chat.sendMessage({ message });
          console.log("Chat API: Success with primary model and Google Search");
          usedSearch = true;
        } catch (searchError: any) {
          const errMsg = searchError.message || String(searchError);
          // If search is blocked, rate-limited, or overloaded, immediately trigger 5 min backoff to protect applet feel and speed
          if (errMsg.includes("quota") || errMsg.includes("429") || errMsg.includes("503") || errMsg.includes("demand") || errMsg.includes("UNAVAILABLE")) {
            isSearchGroundingAvailable = false;
            searchGroundingUnavailableUntil = Date.now() + 5 * 60 * 1000;
            console.log(`Chat API: Grounding tool temporarily disabled for 5 minutes due to API error: ${errMsg.substring(0, 100)}`);
          } else {
            console.warn("Chat API: Standard grounding error:", errMsg);
          }
        }
      }

      // Fast, resilient standard fallback pipeline
      if (!response) {
        console.log("Chat API: Running fallback model gemini-3.1-flash-lite without Search Grounding...");
        const systemInstructionFallback = `${systemInstructionBase}

[System Note: Live Google Search grounding is currently experiencing high demand. Standard live web searches are offline. If the user asks for tracking info and we DO NOT have [LIVE PAKISTAN POST SCRARED WEB TRACKING RESULTS] injected above, explain politely that the live search limit was reached, and encourage them to click on the order status directly to view scraper tracking.]`;

        try {
          const fallbackChat = ai.chats.create({
            model: "gemini-3.1-flash-lite",
            history: formattedHistory,
            config: {
              systemInstruction: systemInstructionFallback
            }
          });
          response = await fallbackChat.sendMessage({ message });
          console.log("Chat API Fallback: Success with gemini-3.1-flash-lite");
        } catch (fbError1: any) {
          console.warn("Chat API Fallback 1 (gemini-3.1-flash-lite) failed. Trying backup gemini-3-flash-preview...", fbError1.message || fbError1);
          
          try {
            const fallbackChat2 = ai.chats.create({
              model: "gemini-3-flash-preview",
              history: formattedHistory,
              config: {
                systemInstruction: systemInstructionFallback
              }
            });
            response = await fallbackChat2.sendMessage({ message });
            console.log("Chat API Fallback: Success with gemini-3-flash-preview");
          } catch (fbError2: any) {
            console.warn("Chat API Fallback 2 (gemini-3-flash-preview) failed. Trying last resort gemini-flash-latest...", fbError2.message || fbError2);
            
            const fallbackChat3 = ai.chats.create({
              model: "gemini-flash-latest",
              history: formattedHistory,
              config: {
                systemInstruction: systemInstructionFallback
              }
            });
            response = await fallbackChat3.sendMessage({ message });
            console.log("Chat API Fallback: Success with last resort gemini-flash-latest");
          }
        }
      }

      res.json({ text: response?.text || "I am currently unable to process your request. Please try again later." });
    } catch (error: any) {
      console.warn("Chat API Error, running local fallback assistant:", error.message || error);
      
      const { message, context } = req.body;
      const query = (message || "").toLowerCase().trim();
      
      const ordersList = context?.orders || [];
      const productsList = context?.products || [];
      
      let totalOrders = ordersList.length;
      let receivedRevenue = 0;
      let receivedProfit = 0;
      let receivedStock = 0;
      let pendingRevenue = 0;
      let pendingProfit = 0;
      let pendingStock = 0;
      let estimatedCostOrders = 0;
      
      const productMap = new Map();
      productsList.forEach((p: any) => {
        productMap.set(p.id, p);
      });
      
      ordersList.forEach((order: any) => {
        const isReceived = order.paymentReceived || false;
        const revenue = Number(order.codAmount || 0);
        
        let totalCost = 0;
        
        if (order.items && Array.isArray(order.items)) {
          order.items.forEach((item: any) => {
            const prod = productMap.get(item.productId);
            const costPrice = Number(prod?.costPrice || 0);
            const qty = Number(item.quantity || 1);
            totalCost += costPrice * qty;
          });
        }
        
        if (totalCost === 0) {
          // Cost price not entered for this order's products: use a clearly
          // marked ESTIMATE instead of silently pretending it is exact.
          totalCost = Math.round(revenue * 0.65);
          estimatedCostOrders++;
        }
        
        const deliveryCharge = Number(order.deliveryCharges || 0);
        const profit = Math.max(0, revenue - totalCost - deliveryCharge);
        const stockCost = totalCost;
        
        if (isReceived) {
          receivedRevenue += revenue;
          receivedProfit += profit;
          receivedStock += stockCost;
        } else {
          pendingRevenue += revenue;
          pendingProfit += profit;
          pendingStock += stockCost;
        }
      });
      
      let reply = "";
      
      if (query.includes("حساب") || query.includes("منافع") || query.includes("ٹوٹل") || query.includes("بچت") || query.includes("profit") || query.includes("revenue") || query.includes("account") || query.includes("stock") || query.includes("بل")) {
        reply = `**السلام علیکم! آپ کے کھاتوں اور منافع کا مکمل حساب کتاب نیچے دیا گیا ہے:**
*(Assalam-o-Alaikum! Here is the complete financial breakdown of your orders and profits based on real-time data)*

### 📊 فنانشل سمری اور بجٹ علیحدگی (Financial & Budget Summary)

| تفصیل (Description) | رقم (Amount) |
|---|---|
| **کل آرڈرز (Total Orders)** | **${totalOrders}** |
| **وصول شدہ کل رقم (Received COD Total)** | Rs. ${receivedRevenue.toLocaleString()} |
| 💰 **میرا خالص منافع - وصول شدہ (My Net Profit - Received)** | **Rs. ${receivedProfit.toLocaleString()}** |
| 📦 **اسٹاک کی قیمت خرید - وصول شدہ (Stock Cost - Received)** | Rs. ${receivedStock.toLocaleString()} |
| **بقایا/غیر وصول شدہ رقم (Pending COD Total)** | Rs. ${pendingRevenue.toLocaleString()} |
| ⏳ **غیر وصول شدہ منافع (Pending Profit)** | Rs. ${pendingProfit.toLocaleString()} |
| 🚚 **اسٹاک کی قیمت - غیر وصول شدہ (Stock Cost - Pending)** | Rs. ${pendingStock.toLocaleString()} |

---

### 💡 اہم مالیاتی مشورہ (Financial Advice):
1. 💸 **منافع علیحدہ کریں (Separate Profit):** آپ کے ہاتھ میں اس وقت **Rs. ${receivedProfit.toLocaleString()}** کا خالص منافع آ چکا ہے۔ آپ اس رقم کو اپنے ذاتی خرچ کے لیے الگ کر سکتے ہیں۔
2. 🛡️ **اسٹاک کا بل (Stock Bill Protection):** وصول شدہ رقم میں سے **Rs. ${receivedStock.toLocaleString()}** خالصاً آپ کے اسٹاک/پراڈکٹس کی قیمت خرید (Capital) ہے۔ اس رقم کو ہرگز خرچ نہ کریں بلکہ اسے نئی خریداروں اور ہول سیل سپلائر کے بلوں کی ادائیگی کے لیے محفوظ رکھیں۔

---
*(نوٹ: یہ حساب آپ کے آرڈرز کے ڈیٹا بیس سے نکالا گیا ہے۔${estimatedCostOrders > 0 ? ` ${estimatedCostOrders} آرڈر میں پراڈکٹ کی قیمت خرید درج نہیں تھی، اس لیے ان آرڈرز کی لاگت کا صرف تخمینہ (ریونیو کا تقریباً 65٪) لگایا گیا ہے — یہ حتمی رقم نہیں۔ بالکل درست منافع کے لیے ہر پراڈکٹ کی قیمت خرید انوینٹری میں درج کریں۔` : " تمام قیمت خرید آپ کی انوینٹری سے لی گئی ہیں۔"})*`;
      }
      else if (query.includes("track") || query.includes("ٹیک") || query.includes("پارسل") || query.includes("status") || query.includes("کہاں") || query.includes("cp") || query.includes("rb") || query.includes("ki") || /[A-Z]{2}\d{9}[A-Z]{2}/i.test(query) || /\bki\d{8,12}\b/i.test(query) || /\b\d{10,15}\b/.test(query)) {
        if (autoScrapedDetails) {
          reply = `**میں نے آپ کے مطلوبہ پارسل کی لائیو ٹریکنگ معلومات حاصل کر لی ہیں:**
*(I have retrieved the live tracking details for your parcel:)*

${autoScrapedDetails}

---
💡 اگر مزید معلومات کی ضرورت ہو تو آپ متعلقہ آرڈر کے آگے 'لائیو دیکھیں' والے بٹن پر بھی کلک کر سکتے ہیں۔`;
        } else {
const trackingMatch = message.toUpperCase().match(/[A-Z]{2}\d{9}[A-Z]{2}/) || 
                                message.toUpperCase().match(/\bKI\d{8,12}\b/) ||
                                message.match(/\b\d{10,15}\b/);
          const tid = trackingMatch ? trackingMatch[0] : null;
          
          if (tid) {
            reply = `**پارسل ٹریکنگ نمبر ${tid} کا ریکارڈ حاصل کیا جا رہا ہے:**
*(Tracking details for Parcel ${tid} are being processed:)*

فی الحال ٹریکنگ سرور مصروف ہے یا معلومات لائیو رجسٹر نہیں ہوئیں۔ 
عام طور پر نئے آرڈرز کو سسٹم میں اپڈیٹ ہونے میں **24 گھنٹے** لگتے ہیں۔ 

براہ کرم درج ذیل چیزوں کی تصدیق کریں:
1. ٹریکنگ آئی ڈی کی سپیلنگ درست ہے۔
2. آرڈر کو روانہ ہوئے کچھ وقت گزر چکا ہے۔

آپ آرڈر کی ہسٹری میں جا کر 'لائیو ٹریک کریں' بٹن دبا کر بھی براہ راست سرکاری پورٹل پر چیک کر سکتے ہیں۔`;
          } else {
            reply = `**پارسل ٹریکنگ کے لیے رہنمائی:**
*(Parcel Tracking Guidance)*

براہ کرم اپنا **ٹریکنگ نمبر** ٹائپ کریں (مثال کے طور پر **CP123456789PK** یا **KI7536838586**)، میں سیکنڈوں میں لائیو ٹریکنگ ہسٹری نکال کر پیش کر دوں گا۔

اگر آپ اپنے کسی گاہک کا پارسل چیک کرنا چاہتے ہیں تو اس کا نام ٹائپ کریں، جیسے "علی کا پارسل کہاں ہے؟"۔`;
          }
        }
      }
      else if (query.includes("پراڈکٹ") || query.includes("آئٹم") || query.includes("سامان") || query.includes("product") || query.includes("inventory") || query.includes("item") || query.includes("مال")) {
        const listItems = productsList.slice(0, 10).map((p: any) => `* **${p.name}** - اسٹاک: ${p.stock || 0} | قیمت خرید: Rs. ${p.costPrice || 0} | قیمت فروخت: Rs. ${p.sellingPrice || 0}`).join("\n");
        reply = `**آپ کی انوینٹری اور اسٹاک کی تفصیلات درج ذیل ہیں:**
*(Here are your current inventory and stock details:)*

${listItems || "فی الحال کوئی پراڈکٹس انوینٹری میں درج نہیں ہیں۔"}

${productsList.length > 10 ? `*(اور ${productsList.length - 10} مزید پراڈکٹس درج ہیں)*` : ""}

💡 **ٹپ:** انوینٹری کو اپڈیٹ کرنے یا نیا اسٹاک شامل کرنے کے لیے آپ اوپر 'انوینٹری' ٹیب کا استعمال کر سکتے ہیں۔`;
      }
      else {
        reply = `**السلام علیکم! میں پاکستان پوسٹ کا آپ کا ذاتی اسسٹنٹ ہوں:**
*(Assalam-o-Alaikum! I am your personal Pakistan Post assistant)*

اے آئی سروس پر عارضی بوجھ کی وجہ سے میں اس وقت **مقامی آف لائن اسسٹنٹ موڈ** میں کام کر رہا ہوں، لیکن میں اب بھی آپ کے کھاتوں، انوینٹری اور لائیو ٹریکنگ میں مدد کر سکتا ہوں۔

**آپ مجھ سے یہ چیزیں پوچھ سکتے ہیں:**
1. 💰 **منافع کا حساب:** "میرا منافع دکھاؤ" یا "میرا حساب کرو" (یہ آپ کو وصول شدہ منافع اور اسٹاک کا بل الگ کرنے میں مدد کرے گا)۔
2. 📦 **پارسل کی لائیو ٹریکنگ:** کوئی بھی ٹریکنگ نمبر درج کریں جیسے \`CP123456789PK\` یا کسی کسٹمر کا نام لکھیے۔
3. 📊 **انوینٹری ہسٹری:** "میرا اسٹاک کتنا ہے؟" یا پراڈکٹس کے نام۔

میں آپ کے کاروبار کو منظم رکھنے کے لیے حاضر ہوں!`;
      }
      
      res.json({ text: reply });
    }
  });

  app.post("/api/optimize-address", async (req, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error("Gemini API key is missing on the server");
      }

      const { customerAddress, customerName, customerPhone, customerCity } = req.body;
      const ai = new GoogleGenAI({ 
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });
      const promptText = `
Given the following raw text that contains customer shipping/delivery information (name, phone, city, address) with possible spelling errors in Urdu (or Roman Urdu/English):
Raw Text: "${customerAddress || ""}"
Current Name: "${customerName || ''}"
Current Phone: "${customerPhone || ''}"
Current City: "${customerCity || ''}"

Goal:
1. Correct spelling/textual mistakes in the Address and City. Make the final Address extremely clean, professional, and well-formatted in Urdu or Roman Urdu/English (matching the input language).
2. Extract the Customer Name:
   - If a customer name (e.g., "حذیفہ", "محمد احمد", "Ali", etc.) is mentioned in the Raw Text, you MUST extract it as customerName, even if there is no "Name" or "نام" label!
   - Carefully distinguish standalone customer names from names that are part of landmarks (like "مسجد قاری نصراللہ", "جامع مسجد عمر", "سکول", "کالج", "مزار", "امام بارگاہ" where the name is part of the landmark name).
   - Often, the customer's name is written near the beginning or the end, or next to a shop indicator like "موبائل" (e.g., "حذیفہ موبائل" indicates the customer name is "حذیفہ" or "حذیفہ موبائل", so extract "حذیفہ" or "حذیفہ موبائل" as customerName).
   - If there is no explicit name but a clear personal name is found standalone, extract it!
3. Extract the Phone:
   - Extract any 11-digit Pakistani phone number (e.g., starting with 03xxxxxxxx or normalized from 923xxxxxxxx).
4. Extract the City:
   - Identify and extract the correct Pakistani city (e.g., "Saddar" is an area in a city, but look for a major city like Karachi, Lahore, Rawalpindi, Islamabad, Peshawar, Multan, Faisalabad, Gujrat, Swat, etc. if mentioned).
5. Clean up the final Address:
   - The final Address should contain the street, landmarks, area, etc., but REMOVE the extracted Customer Name, Phone, and City from the Address string to keep it neat and avoid duplication!
   - Example: If raw is "گلی 1 نزد مسجد قاری نصراللہ حذیفہ موبائل صدر", the customerName is "حذیفہ" or "حذیفہ موبائل", the city is "Saddar" or major city if known, and the address is "گلی 1 نزد مسجد قاری نصراللہ".

Return ONLY a JSON object conforming to the schema. If any field is not found, return an empty string for it. Do not include markdown code block syntax.
      `;

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          customerName: { type: Type.STRING },
          customerPhone: { type: Type.STRING },
          customerCity: { type: Type.STRING },
          customerAddress: { type: Type.STRING }
        }
      };

      let response;
      try {
        console.log("Optimize Address: Trying primary model gemini-3.6-flash...");
        response = await ai.models.generateContent({
          model: "gemini-3.6-flash",
          contents: promptText,
          config: {
            responseMimeType: "application/json",
            responseSchema
          }
        });
        console.log("Optimize Address: Success with primary model gemini-3.6-flash");
      } catch (err1: any) {
        console.log("Optimize Address: Primary model (gemini-3.6-flash) not accessible, trying backup...");
        try {
          console.log("Optimize Address: Trying backup model gemini-flash-latest...");
          response = await ai.models.generateContent({
            model: "gemini-flash-latest",
            contents: promptText,
            config: {
              responseMimeType: "application/json",
              responseSchema
            }
          });
          console.log("Optimize Address: Success with backup model gemini-flash-latest");
        } catch (err2: any) {
          console.log("Optimize Address: Backup model (gemini-flash-latest) not accessible, trying lite backup...");
          try {
            console.log("Optimize Address: Trying backup model gemini-3.1-flash-lite...");
            response = await ai.models.generateContent({
              model: "gemini-3.1-flash-lite",
              contents: promptText,
              config: {
                responseMimeType: "application/json",
                responseSchema
              }
            });
            console.log("Optimize Address: Success with backup model gemini-3.1-flash-lite");
          } catch (err3: any) {
            console.log("Optimize Address: All backup models completed trials, using local fallback parser.");
            throw new Error("Local fallback required");
          }
        }
      }

      const jsonStr = response.text || "{}";
      res.json(JSON.parse(jsonStr));
    } catch (error: any) {
      console.log("Running local fallback address parser...");
      
      const { customerAddress, customerName, customerPhone, customerCity } = req.body;
      
      let extractedName = customerName || '';
      let extractedPhone = customerPhone || '';
      let extractedCity = customerCity || '';
      let extractedCNIC = req.body.customerCNIC || '';
      let cleanedAddress = customerAddress || '';

      // 1. Extract phone number if not present or needs optimization
      // Matches formats like 03xx-xxxxxxx, 03xxxxxxxx, 923xxxxxxxx, +923xxxxxxxx, etc.
      const phoneRegex = /(?:\+?92|0)\s*3[0-9]{2}[-\s]?[0-9]{7}/g;
      const foundPhones = (cleanedAddress.match(phoneRegex) || []) as string[];
      const normalizedPhones: string[] = [];
      
      foundPhones.forEach(ph => {
        let ext = ph.replace(/[\-\s\+]/g, '');
        if (ext.startsWith('92')) {
          ext = '0' + ext.substring(2);
        }
        if (ext.length === 11) {
          normalizedPhones.push(ext);
          cleanedAddress = cleanedAddress.replace(ph, '');
        }
      });

      if (normalizedPhones.length > 0 && !extractedPhone) {
        extractedPhone = normalizedPhones[0];
      }

      // 2. Extract CNIC if present in the address
      const cnicRegex = /[0-9]{5}[-\s]?[0-9]{7}[-\s]?[0-9]{1}/g;
      const foundCNICs = (cleanedAddress.match(cnicRegex) || []) as string[];
      if (foundCNICs.length > 0) {
        const firstCNIC = foundCNICs[0].replace(/[-\s]/g, '');
        if (firstCNIC.length === 13) {
          if (!extractedCNIC) {
            extractedCNIC = firstCNIC;
          }
          cleanedAddress = cleanedAddress.replace(foundCNICs[0], '');
        }
      }

      // 3. Extract city using common Pakistani cities dictionary
      const cityMap: { [key: string]: string } = {
        // Urdu to English mapping
        "کراچی": "Karachi", "لاہور": "Lahore", "اسلام آباد": "Islamabad", "راولپنڈی": "Rawalpindi",
        "فیصل آباد": "Faisalabad", "ملتان": "Multan", "پشاور": "Peshawar", "کوئٹہ": "Quetta",
        "حیدرآباد": "Hyderabad", "گوجرانوالہ": "Gujranwala", "سیالکوٹ": "Sialkot", "ایبٹ آباد": "Abbottabad",
        "بہاولپور": "Bahawalpur", "سرگودھا": "Sargodha", "سکھر": "Sukkur", "سوات": "Swat",
        "مردان": "Mardan", "گجرات": "Gujrat", "جھنگ": "Jhang", "ساہیوال": "Sahiwal",
        "نوابشاہ": "Nawabshah", "میانوالی": "Mianwali", "میرپور": "Mirpur", "مظفرآباد": "Muzaffarabad",
        "گلگت": "Gilgit", "اسکردو": "Skardu", "سکردو": "Skardu", "ہنزہ": "Hunza",
        // English keys (lowercase for safe matching lookup)
        "karachi": "Karachi", "lahore": "Lahore", "islamabad": "Islamabad", "rawalpindi": "Rawalpindi",
        "faisalabad": "Faisalabad", "multan": "Multan", "peshawar": "Peshawar", "quetta": "Quetta",
        "hyderabad": "Hyderabad", "gujranwala": "Gujranwala", "sialkot": "Sialkot", "abbottabad": "Abbottabad",
        "bahawalpur": "Bahawalpur", "sargodha": "Sargodha", "sukkur": "Sukkur", "swat": "Swat",
        "mardan": "Mardan", "gujrat": "Gujrat", "jhang": "Jhang", "sahiwal": "Sahiwal",
        "nawabshah": "Nawabshah", "mianwali": "Mianwali", "mirpur": "Mirpur", "muzaffarabad": "Muzaffarabad",
        "gilgit": "Gilgit", "skardu": "Skardu", "hunza": "Hunza", "swabi": "Swabi", "kohat": "Kohat",
        "nowshera": "Nowshera", "charsadda": "Charsadda", "bannu": "Bannu", "sheikhupura": "Sheikhupura",
        "kasur": "Kasur", "okara": "Okara", "rahim yar khan": "Rahim Yar Khan", "rahimyar khan": "Rahim Yar Khan",
        "chiniot": "Chiniot", "kamoke": "Kamoke", "sadiqabad": "Sadiqabad", "turbat": "Turbat",
        "shikarpur": "Shikarpur", "hafizabad": "Hafizabad", "jhelum": "Jhelum", "khanewal": "Khanewal",
        "khairpur": "Khairpur", "dadu": "Dadu", "gojra": "Gojra", "muridke": "Muridke",
        "bahawalnagar": "Bahawalnagar", "pakpattan": "Pakpattan", "toba tek singh": "Toba Tek Singh",
        "tobatek singh": "Toba Tek Singh", "tts": "Toba Tek Singh", "vehari": "Vehari",
        "shorkot": "Shorkot", "pattoki": "Pattoki", "wazirabad": "Wazirabad", "gwadar": "Gwadar",
        "attock": "Attock", "bhakkar": "Bhakkar", "layyah": "Layyah", "rajanpur": "Rajanpur",
        "muzaffargarh": "Muzaffargarh", "ghotki": "Ghotki", "jacobabad": "Jacobabad", "kashmore": "Kashmore",
        "larkana": "Larkana", "qambar": "Qambar", "jamshoro": "Jamshoro", "matiari": "Matiari",
        "tando allahyar": "Tando Allahyar", "tando muhammad khan": "Tando Muhammad Khan", "badin": "Badin",
        "sujawal": "Sujawal", "thatta": "Thatta", "malir": "Malir", "korangi": "Korangi", "keamari": "Keamari",
        "haripur": "Haripur", "karak": "Karak"
      };

      const pakCities = Object.keys(cityMap);
      pakCities.sort((a, b) => b.length - a.length);

      const getBoundarySafeRegex = (word: string) => {
        if (/[\u0600-\u06FF]/.test(word)) {
          return new RegExp("(?:^|[^\\u0600-\\u06FF])(" + word + ")(?:$|[^\\u0600-\\u06FF])", "i");
        } else {
          return new RegExp("\\b(" + word + ")\\b", "i");
        }
      };

      for (const city of pakCities) {
        const regex = getBoundarySafeRegex(city);
        const match = cleanedAddress.match(regex);
        if (match && match.index !== undefined) {
          const matchedCityName = match[1];
          if (!extractedCity) {
            extractedCity = cityMap[city.toLowerCase()] || city;
          }
          const wordIndex = match.index + match[0].indexOf(matchedCityName);
          cleanedAddress = cleanedAddress.substring(0, wordIndex) + cleanedAddress.substring(wordIndex + matchedCityName.length);
          break;
        }
      }

      if (extractedCity && /^[a-zA-Z\s]+$/.test(extractedCity)) {
        extractedCity = extractedCity.replace(/\b[a-zA-Z]/g, (l) => l.toUpperCase());
      }

      // 4. Extract Name using labels or contextual triggers with advanced Pakistani/Muslim name parser
      const nameLabelRegex = /(?:Name|نام|گاہک کا نام|کسٹمر|موصول کنندہ|Receiver|Customer|Client|بھجوانے والا)\s*[:\-\.۔]*\s*([A-Za-z\u0600-\u06FF\s]+?)(?:[,\n\r]|$)/i;
      const nameMatch = cleanedAddress.match(nameLabelRegex);
      if (nameMatch && nameMatch[1].trim().length > 2) {
        extractedName = nameMatch[1].trim();
        cleanedAddress = cleanedAddress.replace(nameMatch[0], '').trim();
      } else {
        const commonUrduNames = [
          "محمد", "علی", "احمد", "خان", "عمران", "بلال", "حمزہ", "عثمان", "حذیفہ", "طلحہ", 
          "انس", "جنید", "عمر", "ابوبکر", "زبیر", "یاسر", "عرفان", "فیصل", "نعمان", "رضوان", 
          "عدنان", "کامران", "سلمان", "شہزاد", "کاشف", "شاہد", "آصف", "وقار", "طارق", "ساجد", 
          "ماجد", "امجد", "اسد", "حسن", "حسین", "طاہر", "ظفر", "اقبال", "ثاقب", "وقاص", 
          "نوید", "جواد", "شفیق", "خالد", "فیاض", "اصغر", "اکرم", "ارسلان", "ہارون", "ذیشان", 
          "زیشان", "آفتاب", "فراز", "عمیر", "سفیان", "سعد", "معاذ", "عامر", "شعیب", "بابر", 
          "طہ", "طٰہٰ", "بشارت", "امتیاز", "ممتاز", "ریاض", "فہیم", "عاطف", "ندیم", "وسیم", 
          "سہیل", "مظہر", "تنویر", "منیر", "نواز", "شہباز", "رحمان", "شریف", "لطیف", "جمیل", 
          "حبیب", "بشیر", "شاکر", "صابر", "ظاہر", "قاسم", "رحیم", "کریم", "آفتاب", "بشارت"
        ];

        const commonEngNames = [
          "muhammad", "ali", "ahmad", "ahmed", "khan", "imran", "bilal", "hamza", "usman", "huzaifa",
          "talha", "anas", "junaid", "umer", "umar", "abubakar", "zubair", "yasir", "irfan", "faisal",
          "noman", "nouman", "rizwan", "adnan", "kamran", "salman", "shahzad", "kashif", "shahid", "asif",
          "waqar", "tariq", "sajid", "majid", "amjad", "asad", "hasan", "hassan", "husain", "hussain",
          "tahir", "zafar", "iqbal", "saqib", "waqas", "naveed", "jawad", "shafiq", "khalid", "fayyaz",
          "asghar", "akram", "arslan", "haroon", "zeeshan", "aftab", "faraz", "umair", "sufyan", "saad",
          "maaz", "aamir", "amir", "shoaib", "babar", "taha", "imtiaz", "mumtaz", "riaz", "faheem",
          "fahim", "atif", "nadeem", "waseem", "sohail", "mazhar", "tanveer", "munir", "nawaz", "shahbaz",
          "rehman", "basit", "raza"
        ];

        const landmarkPrefixes = [
          "مسجد", "جامع مسجد", "امام بارگاہ", "مزار", "اسکول", "سکول", "کالج", "مدرسہ", "دربار", "چوک", "روڈ", "ٹاؤن", "کالونی", "بلاک", "سیکٹر", "فیز", "گلی", "کوٹ", "ڈھوک", "پنڈ", "موضع", "مکان", "دوکان", "دکان", "شاپ", "کیفے", "ہوٹل", "ہاؤس",
          "mosque", "masjid", "school", "college", "road", "chowk", "town", "colony", "block", "sector", "phase", "street", "gali", "shop", "cafe", "hotel", "house"
        ];

        // Helper to check if a name is preceded by a landmark prefix within 2-3 words
        const isPartofLandmark = (fullText: string, name: string, nameIndex: number) => {
          const precedingText = fullText.substring(0, nameIndex).trim();
          if (!precedingText) return false;
          const samplePreceding = precedingText.substring(precedingText.length - 25).trim();
          const words = samplePreceding.split(/[\s,;\-\:۔\.\/]+/).filter(Boolean);
          const wordsToCheck = words.slice(-3);
          return wordsToCheck.some(w => landmarkPrefixes.some(p => p.toLowerCase() === w.toLowerCase()));
        };

        interface FoundNameInfo {
          name: string;
          index: number;
          isUrdu: boolean;
        }

        const candidates: FoundNameInfo[] = [];

        // Scan Urdu names
        commonUrduNames.forEach(name => {
          let index = cleanedAddress.indexOf(name);
          while (index !== -1) {
            const beforeChar = index > 0 ? cleanedAddress.charAt(index - 1) : '';
            const afterChar = index + name.length < cleanedAddress.length ? cleanedAddress.charAt(index + name.length) : '';
            const isWordBoundaryBefore = !beforeChar || /[\s,;\-\:۔\.\/\d]/.test(beforeChar);
            const isWordBoundaryAfter = !afterChar || /[\s,;\-\:۔\.\/\d]/.test(afterChar);
            
            if (isWordBoundaryBefore && isWordBoundaryAfter && !isPartofLandmark(cleanedAddress, name, index)) {
              candidates.push({ name, index, isUrdu: true });
            }
            index = cleanedAddress.indexOf(name, index + 1);
          }
        });

        // Scan English names
        commonEngNames.forEach(name => {
          const regex = new RegExp(`\\b${name}\\b`, 'gi');
          let match;
          while ((match = regex.exec(cleanedAddress)) !== null) {
            if (!isPartofLandmark(cleanedAddress, match[0], match.index)) {
              candidates.push({ name: match[0], index: match.index, isUrdu: false });
            }
          }
        });

        candidates.sort((a, b) => a.index - b.index);

        if (candidates.length > 0) {
          let mergedName = candidates[0].name;
          let lastEndIndex = candidates[0].index + candidates[0].name.length;
          
          for (let i = 1; i < candidates.length; i++) {
            const nextName = candidates[i];
            const gap = cleanedAddress.substring(lastEndIndex, nextName.index);
            if (/^[\s,;\-\:۔\.\/]*$/.test(gap)) {
              mergedName += gap + nextName.name;
              lastEndIndex = nextName.index + nextName.name.length;
            } else {
              break;
            }
          }

          // Check if followed immediately by business/shop suffix
          const followingText = cleanedAddress.substring(lastEndIndex);
          const matchFollowing = followingText.match(/^([\s,;\-\:۔\.\/]+)(موبائل|موبائیل|شاپ|سٹور|اسٹور|سینٹر|سینڑ|الیکٹرانکس|ٹیلر|بوتیک|بیکری|مارٹ|mobile|shop|store|center|electronics|tailor|bakery|mart)\b/i);
          if (matchFollowing) {
            mergedName += matchFollowing[1] + matchFollowing[2];
          }

          if (mergedName.length > 2) {
            extractedName = mergedName;
            cleanedAddress = cleanedAddress.replace(mergedName, '').trim();
          }
        } else {
          // Fallback: Look for the first occurrence of any address indicator or digit to find name at the start
          let earliestIndex = -1;
          const numberRegex = /\b\d+\b/;
          const numberMatch = cleanedAddress.match(numberRegex);
          if (numberMatch && numberMatch.index !== undefined) {
            earliestIndex = numberMatch.index;
          }

          const addressIndicators = [
            'house', 'h#', 'flat', 'f#', 'plot', 'p#', 'street', 'st', 'st#', 'road', 'rd', 'gali', 'gali#', 'block', 'sector', 'phase', 'town', 'colony', 'near', 'opposite', 'opp', 'chak', 'p/o', 'po', 'tehsil', 'dist', 'district', 'ward', 'b#', 'shop', 'bazar', 'bazaar', 'mohalla', 'mohallah', 'dhoke', 'kili', 'mouza', 'pind', 'village', 'qila', 'basti',
            'مکان', 'گلی', 'روڈ', 'چوک', 'بلاک', 'چک', 'تحصیل', 'ضلع', 'ڈاکخانہ', 'نزد', 'محلہ', 'کالونی', 'ٹاؤن', 'فلیٹ', 'دکان', 'پلاٹ', 'وارڈ', 'ہاؤس', 'شاپ', 'کیفے', 'کالج', 'اسکول', 'مسجد', 'نزدیک', 'بزار', 'بازار', 'موضع', 'پنڈ', 'بستی', 'قلعہ'
          ];

          for (const ind of addressIndicators) {
            const regex = getBoundarySafeRegex(ind);
            const match = cleanedAddress.match(regex);
            if (match && match.index !== undefined) {
              const capturedWord = match[1];
              const actualIndex = match[0].indexOf(capturedWord) + match.index;
              if (earliestIndex === -1 || actualIndex < earliestIndex) {
                earliestIndex = actualIndex;
              }
            }
          }

          if (earliestIndex > 2) {
            let possibleName = cleanedAddress.substring(0, earliestIndex).trim();
            possibleName = possibleName.replace(/^[\s,;\-\:۔\.\/]+|[\s,;\-\:۔\.\/]+$/g, '').trim();
            if (possibleName.length > 2 && !/\d/.test(possibleName) && possibleName.split(/\s+/).length <= 5) {
              extractedName = possibleName;
              cleanedAddress = cleanedAddress.substring(earliestIndex).trim();
            }
          } else {
            // Line split fallback
            const lines = cleanedAddress.split(/[\n\r,]+/);
            if (lines.length > 1) {
              const firstLine = lines[0].trim();
              if (firstLine.length > 2 && firstLine.length < 25 && !/\d/.test(firstLine)) {
                let hasIndicator = false;
                for (const ind of addressIndicators) {
                  const regex = getBoundarySafeRegex(ind);
                  if (regex.test(firstLine)) {
                    hasIndicator = true;
                    break;
                  }
                }
                if (!hasIndicator) {
                  extractedName = firstLine;
                  cleanedAddress = lines.slice(1).join(', ').trim();
                }
              }
            }
          }
        }
      }

      if (extractedName && /^[a-zA-Z\s]+$/.test(extractedName)) {
        extractedName = extractedName.replace(/\b[a-zA-Z]/g, (l) => l.toUpperCase());
      }

      // 5. Clean up address
      cleanedAddress = cleanedAddress
        .replace(/(?:Address|پتہ|ایڈریس)\s*[:\-\.۔]*/gi, '')
        .replace(/(?:Phone|Ph|Mob|Mobile|نمبر|فون|موبائل|Cell|City|شہر|CNIC|شناختی کارڈ|شناختی کارڈ نمبر)\s*[:\-\.۔]?\s*(?=\b|,|$)/gi, '')
        .replace(/[*&%$!^()\[\]{}"]/g, '')
        .replace(/[\n\r]+/g, ', ')
        .replace(/,+|،+/g, ', ')
        .replace(/\s+/g, ' ')
        .trim();

      cleanedAddress = cleanedAddress.replace(/^[\s,]+|[\s,]+$/g, '');

      res.json({
        customerName: extractedName.trim(),
        customerPhone: extractedPhone.trim(),
        customerCity: extractedCity.trim(),
        customerCNIC: extractedCNIC.trim(),
        customerAddress: cleanedAddress || customerAddress || ''
      });
    }
  });

  // Process Customer Voice Note / Audio for Address & Order Extraction
  app.post("/api/process-voice-address", async (req, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(400).json({ 
          error: "Gemini API key is missing on the server",
          urduMessage: "سرور پر AI کی API Key دستیاب نہیں ہے۔"
        });
      }

      const { audioBase64, mimeType = "audio/webm", availableProducts = [] } = req.body;

      if (!audioBase64) {
        return res.status(400).json({ error: "No audio data provided" });
      }

      // Clean base64 data URL prefix if present
      const cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, '');

      const ai = new GoogleGenAI({ 
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      // Normalize common audio mime types
      let normalizedMimeType = mimeType || 'audio/webm';
      if (normalizedMimeType.includes('opus') || normalizedMimeType.includes('ogg')) {
        normalizedMimeType = 'audio/ogg';
      } else if (normalizedMimeType.includes('mp4') || normalizedMimeType.includes('m4a') || normalizedMimeType.includes('aac')) {
        normalizedMimeType = 'audio/mp4';
      } else if (normalizedMimeType.includes('wav')) {
        normalizedMimeType = 'audio/wav';
      } else if (normalizedMimeType.includes('mp3') || normalizedMimeType.includes('mpeg')) {
        normalizedMimeType = 'audio/mp3';
      } else if (normalizedMimeType.includes('webm')) {
        normalizedMimeType = 'audio/webm';
      }

      const audioPart = {
        inlineData: {
          mimeType: normalizedMimeType,
          data: cleanBase64,
        }
      };

      const productsContext = availableProducts.length > 0 
        ? `Available store products: ${JSON.stringify(availableProducts.map((p: any) => ({ id: p.id, name: p.name, price: p.sellingPrice })))}`
        : '';

      const voicePrompt = `
You are an expert Pakistani Urdu, Roman Urdu, and English speech transcriber and ecommerce logistics parser for Pakistan online businesses.
The user provided a customer voice note (audio message sent on WhatsApp or voice recording).
${productsContext}

Listen carefully to this audio recording and perform two crucial steps:
1. Accurate, faithful transcription of everything spoken in Urdu, Roman Urdu, or English.
2. Extract and structure the customer's delivery information:
   - "customerName": Customer's personal name if spoken (e.g., "محمد عثمان", "Ali Khan", "Hafiz Bilal", "Fatima").
   - "customerPhone": Primary 11-digit Pakistani phone number (format 03xx-xxxxxxx or 03001234567).
   - "customerPhone2": Secondary or backup phone number if an alternate was mentioned.
   - "customerCity": Delivery destination city in Pakistan (e.g. Lahore, Karachi, Rawalpindi, Islamabad, Faisalabad, Multan, Peshawar, Quetta, Gujranwala, Sialkot, Hyderabad, Abbottabad, Swat, etc.).
   - "customerAddress": Clean, complete street/house address excluding the city name and phone numbers. (Include house#, flat#, street#, block, sector, phase, mohallah, landmark, village, road, shop name).
   - "customerCNIC": 13-digit CNIC if explicitly mentioned.
   - "detectedItems": Array of items/products mentioned in the audio (e.g. { "name": "Suit", "quantity": 2, "price": 2500 }). Match with available store products if applicable.
   - "totalAmount": Total COD amount mentioned in the audio (number, e.g. 2500, 3000, 0 if none).
   - "deliveryInstructions": Special delivery notes (e.g. "urgent delivery", "call before delivering", "give at office after 2pm").
   - "summary": A helpful, friendly 1-sentence Urdu summary of the parsed details.

Return ONLY a valid JSON object. Do not wrap in markdown or backticks.
`;

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          transcription: { type: Type.STRING },
          customerName: { type: Type.STRING },
          customerPhone: { type: Type.STRING },
          customerPhone2: { type: Type.STRING },
          customerCity: { type: Type.STRING },
          customerAddress: { type: Type.STRING },
          customerCNIC: { type: Type.STRING },
          detectedItems: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                quantity: { type: Type.NUMBER },
                price: { type: Type.NUMBER }
              }
            }
          },
          totalAmount: { type: Type.NUMBER },
          deliveryInstructions: { type: Type.STRING },
          summary: { type: Type.STRING }
        }
      };

      let response;
      const modelsToTry = [
        "gemini-3.8-flash",
        "gemini-flash-latest"
      ];

      let lastError: any = null;
      for (const modelName of modelsToTry) {
        try {
          console.log(`Processing voice address with model: ${modelName}...`);
          response = await ai.models.generateContent({
            model: modelName,
            contents: {
              parts: [
                audioPart,
                { text: voicePrompt }
              ]
            },
            config: {
              responseMimeType: "application/json",
              responseSchema
            }
          });

          if (response?.text) {
            console.log(`Success processing voice address with model ${modelName}`);
            break;
          }
        } catch (err: any) {
          console.warn(`Model ${modelName} failed on audio processing:`, err.message || err);
          lastError = err;
        }
      }

      // If multimodal flash models failed, try dedicated audio transcription model
      if (!response || !response.text) {
        try {
          console.log("Trying dedicated gemini-3.5-transcribe model...");
          const transResponse = await ai.models.generateContent({
            model: "gemini-3.5-transcribe",
            contents: {
              parts: [
                audioPart
              ]
            }
          });

          const transcription = transResponse.text || "";
          console.log("Audio transcribed successfully:", transcription);

          // Now parse the transcribed text using text-based address optimization
          if (transcription.trim()) {
            const parsedTextResponse = await ai.models.generateContent({
              model: "gemini-3.8-flash",
              contents: `Given this transcribed customer voice note: "${transcription}"\nExtract customerName, customerPhone, customerPhone2, customerCity, customerAddress, customerCNIC, totalAmount into JSON matching the schema.`,
              config: {
                responseMimeType: "application/json",
                responseSchema
              }
            });

            if (parsedTextResponse.text) {
              const cleanedText = parsedTextResponse.text.replace(/```json\n?|\n?```/g, '').trim();
              const parsedJson = JSON.parse(cleanedText);
              return res.json({
                success: true,
                transcription,
                ...parsedJson
              });
            }
          }
        } catch (transErr: any) {
          console.error("Transcription model trial failed:", transErr.message || transErr);
        }
      }

      if (!response || !response.text) {
        throw lastError || new Error("Failed to process audio with Gemini models");
      }

      const jsonStr = (response.text || "{}").replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      res.json({
        success: true,
        ...parsed
      });
    } catch (error: any) {
      console.error("Voice address processing error:", error);
      res.status(500).json({ 
        error: error.message || "Failed to process voice note",
        urduMessage: "وائس نوٹ پروسیس کرنے میں خرابی ہوئی، براہ کرم آڈیو کو دوبارہ چیک کریں یا مائیکرو فون سے واضح آواز میں بولیں۔"
      });
    }
  });

  // Dedicated Audio Transcribe endpoint (for chatbot voice notes and general audio)
  app.post("/api/transcribe-audio", async (req, res) => {
    try {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(400).json({ error: "Gemini API key is missing on the server" });
      }

      const { audioBase64, mimeType = "audio/webm" } = req.body;
      if (!audioBase64) {
        return res.status(400).json({ error: "No audio data provided" });
      }

      const cleanBase64 = audioBase64.replace(/^data:[^;]+;base64,/, '');
      const ai = new GoogleGenAI({ 
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
      });

      let normalizedMimeType = mimeType || 'audio/webm';
      if (normalizedMimeType.includes('opus') || normalizedMimeType.includes('ogg')) {
        normalizedMimeType = 'audio/ogg';
      } else if (normalizedMimeType.includes('mp4') || normalizedMimeType.includes('m4a') || normalizedMimeType.includes('aac')) {
        normalizedMimeType = 'audio/mp4';
      } else if (normalizedMimeType.includes('wav')) {
        normalizedMimeType = 'audio/wav';
      } else if (normalizedMimeType.includes('mp3') || normalizedMimeType.includes('mpeg')) {
        normalizedMimeType = 'audio/mp3';
      } else if (normalizedMimeType.includes('webm')) {
        normalizedMimeType = 'audio/webm';
      }

      const audioPart = {
        inlineData: {
          mimeType: normalizedMimeType,
          data: cleanBase64,
        }
      };

      let response;
      try {
        response = await ai.models.generateContent({
          model: "gemini-3.5-transcribe",
          contents: {
            parts: [
              audioPart,
              { text: "Transcribe this customer voice message accurately into Urdu / Roman Urdu / English text." }
            ]
          }
        });
      } catch (err) {
        // Fallback to gemini-2.5-flash
        response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: {
            parts: [
              audioPart,
              { text: "Transcribe this customer audio message into Urdu and English text accurately." }
            ]
          }
        });
      }

      res.json({
        success: true,
        transcription: response.text || ""
      });
    } catch (error: any) {
      console.error("Transcribe audio error:", error);
      res.status(500).json({ error: error.message || "Failed to transcribe audio" });
    }
  });

  // Static frontend serving is skipped in serverless mode (API-only there; the host serves dist/ itself).
  if (!IS_SERVERLESS) {
    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  return app;
}

// Long-running hosts (local dev, Docker, Render-style): boot the HTTP server here.
// In serverless mode (Vercel/Netlify) the function wrapper calls createApp()
// per invocation instead, so we must NOT listen here.
if (!IS_SERVERLESS) {
  const PORT = Number(process.env.PORT) || 3000;
  createApp()
    .then((app) => {
      app.listen(PORT, "0.0.0.0", () => {
        console.log(`Server running on http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error("Failed to start server:", err);
      process.exit(1);
    });
}
