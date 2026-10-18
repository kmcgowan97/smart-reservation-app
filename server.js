const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const db = require('./db/database');
const OpenAI  = require('openai');

// Load local development credentials without committing them to source control.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

const app = express();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Landing page
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: __dirname + '/public' });
});

app.get('/reservations', (req, res) => {
  const { date, time, party_size, customer_name } = req.query;

  let query = 'SELECT * FROM reservations';
  let conditions = [];
  let params = [];

  if (date) {
    conditions.push('date = ?');
    params.push(date);
  }

  if (time) {
    conditions.push('time = ?');
    params.push(time);
  }

  if (party_size) {
    conditions.push('party_size = ?');
    params.push(parseInt(party_size));
  }

  if (customer_name) {
    conditions.push('customer_name LIKE ?');
    params.push(`%${customer_name}%`);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  const reservations = db.prepare(query).all(...params);

  res.json(reservations);
});

app.post('/reservations', (req, res) => {
  const errors = validateReservation(req.body);
  
  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  const { customer_name, date, time, party_size, notes } = req.body;

  const stmt = db.prepare(`
    INSERT INTO reservations (customer_name, date, time, party_size, notes)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(customer_name, date, time, party_size, notes);

  res.json({
    message: 'Reservation saved',
    id: result.lastInsertRowid
  });
});

// Busiest times for a given date
app.get('/analytics/busiest-times', (req, res) => {
  const { date } = req.query;

  let query = `
    SELECT time, COUNT(*) as total_reservations
    FROM reservations
  `;

  let params = [];

  if (date) {
    query += ' WHERE date = ?';
    params.push(date);
  }

  query += `
    GROUP BY time
    ORDER BY total_reservations DESC
  `;

  const results = db.prepare(query).all(...params);

  res.json(results);
});

// Total reservations per day
app.get('/analytics/reservations-per-day', (req, res) => {
  const results = db.prepare(`
    SELECT date, COUNT(*) as total_reservations
    FROM reservations
    GROUP BY date
    ORDER BY date ASC
  `).all();

  res.json(results);
});

//Total guests per day
app.get('/analytics/guests-per-day', (req, res) => {
  const { date } = req.query;

  let query = `
    SELECT date, SUM(party_size) as total_guests
    FROM reservations
  `;

  let params = [];

  if (date) {
    query += ' WHERE date = ?';
    params.push(date);
  }

  query += ' GROUP BY date ORDER BY date ASC';

  const results = db.prepare(query).all(...params);

  res.json(results);
});


// Average party size per day
app.get('/analytics/average-party-size', (req, res) => {
  const { date } = req.query;

  let query = `
    SELECT date, AVG(party_size) as average_party_size
    FROM reservations
  `;

  let params = [];

  if (date) {
    query += ' WHERE date = ?';
    params.push(date);
  }

  query += ' GROUP BY date ORDER BY date ASC';

  const results = db.prepare(query).all(...params);

  res.json(results);
});

//AI Endpoint
app.post('/ai/query', async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({
        error: 'Question is required'
      });
    }

    //Ask AI to determine intent
    const intentPrompt = `
      You are an API assistant.

      Classify the user's question into one of these intents:
      - busiest_times
      - guests_per_day
      - reservations_per_day

      Also extract a date if mentioned (YYYY-MM-DD), otherwise null.

      Return ONLY JSON like:
      {
        "intent": "...",
        "date": "..."
      }

      User question:
      "${question}"
      `;

    const intentResponse = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'user', content: intentPrompt }
      ]
    });

    let intentData;

    try {
      intentData = JSON.parse(
        intentResponse.choices[0].message.content
      );
    } catch (e) {
      return res.status(400).json({
        error: 'Could not understand question'
      });
    }

    let data = null;
    let contextDescription = '';

    if (intentData.intent === 'busiest_times') {
      contextDescription = 'Busiest reservation times';

      let query = `
        SELECT time, COUNT(*) as total_reservations
        FROM reservations
      `;

      let params = [];

      if (intentData.date) {
        query += ' WHERE date = ?';
        params.push(intentData.date);
      }

      query += ' GROUP BY time ORDER BY total_reservations DESC';

      data = db.prepare(query).all(...params); //clarity

    } else if (intentData.intent === 'guests_per_day') {
      contextDescription = 'Total guests per day';

      data = db.prepare(`
        SELECT date, SUM(party_size) as total_guests
        FROM reservations
        GROUP BY date
        ORDER BY date ASC
      `).all();

    } else if (intentData.intent === 'reservations_per_day') {
      contextDescription = 'Reservations per day';

      data = db.prepare(`
        SELECT date, COUNT(*) as total_reservations
        FROM reservations
        GROUP BY date
        ORDER BY date ASC
      `).all();

    } else {
      return res.status(400).json({
        error: 'Unsupported question type'
      });
    }

    // Build final prompt
    const finalPrompt = `
      You are a restaurant analytics assistant.

      Context: ${contextDescription}

      Data:
      ${JSON.stringify(data)}

      Answer the following question clearly and concisely:
      "${question}"
      `;

    // Call OpenAI
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: 'You analyze restaurant reservation data and provide clear insights.'
        },
        {
          role: 'user',
          content: finalPrompt
        }
      ]
    });

    const aiAnswer = response.choices[0].message.content;

    // Return response
    res.json({
      question,
      answer: aiAnswer,
      data_used: data // debug only
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Something went wrong'
    });
  }
});


// Start server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

function validateReservation(data) {
  const errors = [];

  if (!data.customer_name || data.customer_name.trim() === '') {
    errors.push('Customer name is required');
  }

  if (!data.date || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    errors.push('Valid date (YYYY-MM-DD) is required');
  }

  if (!data.time) {
    errors.push('Time is required');
  }

  if (
    data.party_size === undefined ||
    isNaN(data.party_size) ||
    Number(data.party_size) <= 0
  ) {
    errors.push('Party size must be a positive number');
  }

  return errors;
}
