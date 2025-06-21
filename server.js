require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { OpenAI } = require('openai');

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({ dest: 'uploads/' });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper: safely parse possibly broken JSON
function trySafeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      try {
        return JSON.parse(text.slice(first, last + 1));
      } catch {
        return { error: "Invalid JSON format", raw: text };
      }
    }
    return { error: "Invalid JSON format", raw: text };
  }
}

app.post('/upload', upload.single('pdf'), async (req, res) => {
  try {
    const filePath = req.file.path;
    const outputPath = `${filePath}-images`;

    // Create output folder
    fs.mkdirSync(outputPath, { recursive: true });

    // Convert PDF to image(s)
    const command = `pdftoppm -jpeg -scale-to 1024 ${filePath} ${outputPath}/page`;
    execSync(command);
    console.log("✅ PDF converted to images");

    const imagePaths = fs.readdirSync(outputPath)
      .filter(f => f.endsWith('.jpg'))
      .map(f => path.join(outputPath, f));

    const results = [];

    for (let imgPath of imagePaths) {
      const imageBuffer = fs.readFileSync(imgPath);

      console.log(`📤 Sending image to OpenAI: ${imgPath}`);

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are a financial assistant helping parse a Curaçao bank statement.
Extract all bank transactions from this image.

Each transaction:
- may span 2-3 lines (e.g., card number, extra notes),
- must include ALL description lines as one "description" field,
- may include either a debit or credit (not both),
- has a final balance (like "1.769,87CR").

Also extract the statement's month and year from the top of the page.

Return only a valid JSON object like this:
{
  "meta": {
    "month": "February",
    "year": "2024"
  },
  "transactions": [
    {
      "date": "13/02",
      "description": "MCB Money card USD ************7386 Neff ps4 gift card 10 dollars",
      "debit": "18,20",
      "credit": "",
      "balance": "1.109,11CR"
    }
  ]
}`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
                }
              }
            ]
          }
        ],
        max_tokens: 1500
      });

      const rawText = response.choices[0].message.content || '';
      const cleanText = rawText.replace(/```json\n?/, '').replace(/```/, '');
      const parsed = trySafeJsonParse(cleanText);
      results.push(parsed);
    }

    res.json({ extracted: results });

    // Clean up
    fs.rmSync(filePath, { force: true });
    fs.rmSync(outputPath, { recursive: true, force: true });

  } catch (err) {
    console.error("❌ Error processing file:", err);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

