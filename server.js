require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { OpenAI } = require('openai');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({ dest: 'uploads/' });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function trySafeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last > first) {
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
    if (!req.file) {
      throw new Error("❌ No file received. Ensure form-data field is named 'pdf'.");
    }

    const filePath = req.file.path;
    const outputPath = `${filePath}-images`;

    console.log(`📥 Received file: ${filePath}`);
    fs.mkdirSync(outputPath, { recursive: true });

    const command = `pdftoppm -jpeg -scale-to 1024 ${filePath} ${outputPath}/page`;
    console.log(`🔧 Running command: ${command}`);
    execSync(command);
    console.log("✅ PDF converted to images");

    const imagePaths = fs.readdirSync(outputPath)
      .filter(f => f.endsWith('.jpg'))
      .map(f => path.join(outputPath, f));

    const results = await Promise.all(imagePaths.map(async (imgPath) => {
      const imageBuffer = fs.readFileSync(imgPath);

      const compressedImage = await sharp(imageBuffer)
        .resize({ width: 900 })
        .jpeg({ quality: 60 })
        .toBuffer();

      console.log(`📤 Sending compressed image to OpenAI: ${imgPath}`);

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are an expert assistant that reads CVs and resumes from images or PDFs and extracts structured data for a career platform.

Extract the following fields from the document:
- Full Name
- Contact Info (email, phone, LinkedIn)
- Job Title(s)
- Work Experience (each with title, company, duration, description)
- Education (degree, school, graduation year)
- Skills (bullet list)
- Certifications (if any)
- Languages
- Location (City, Country if available)

Return the output in JSON format like this:

{
  "full_name": "John Doe",
  "contact": {
    "email": "john@example.com",
    "phone": "+599 9 123-4567",
    "linkedin": "linkedin.com/in/johndoe"
  },
  "work_experience": [
    {
      "title": "Marketing Manager",
      "company": "ABC Corp",
      "duration": "Jan 2021 – Present",
      "description": "Managed campaigns, increased conversion by 20%..."
    }
  ],
  "education": [
    {
      "degree": "Bachelor of Science in Marketing",
      "school": "University of Curaçao",
      "year": "2020"
    }
  ],
  "skills": ["SEO", "Data Analysis", "Copywriting"],
  "certifications": ["Google Ads Certification"],
  "languages": ["English", "Papiamentu"],
  "location": "Curaçao"
}`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${compressedImage.toString('base64')}`
                }
              }
            ]
          }
        ],
        max_tokens: 1500
      });

      const rawText = response.choices[0].message.content || '';
      const cleanText = rawText.replace(/```json\n?/, '').replace(/```/, '');
      return trySafeJsonParse(cleanText);
    }));

    console.log("✅ AI Parsing Complete. Sending response...");
    res.json({ extracted: results });

    // Clean up files
    fs.rmSync(filePath, { force: true });
    fs.rmSync(outputPath, { recursive: true, force: true });

  } catch (err) {
    console.error("❌ Error processing file:", err);
    res.status(500).json({ error: err.message || 'Failed to process file' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
