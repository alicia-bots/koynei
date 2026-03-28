// FILE: server.js
require('dotenv').config();
const express   = require('express');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const cors      = require('cors');
const path      = require('path');
const multer    = require('multer');
const fs        = require('fs');
const { v4: uuidv4 } = require('uuid');
const DB        = require('./database');

const app        = express();
const PORT       = process.env.PORT       || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'novatalent-secret-2024';

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename:    (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// ── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}
const co  = (req, res, next) => { if (req.user.role !== 'company')   return res.status(403).json({ error: 'Forbidden' }); next(); };
const app_ = (req, res, next) => { if (req.user.role !== 'applicant') return res.status(403).json({ error: 'Forbidden' }); next(); };

// ── CLAUDE HELPER ────────────────────────────────────────────────────────────
async function callClaude(messages, maxTokens = 2000) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'x-api-key': key, 'anthropic-version':'2023-06-01' },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: maxTokens, messages }),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message || 'Claude error'); }
  const data = await res.json();
  return data.content.find(b => b.type === 'text')?.text || '';
}

function parseJSON(raw) {
  const clean = raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
  return JSON.parse(clean);
}

// ── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, role, name, companyName, website, companyLocation, description } = req.body;
    if (!email || !password || !role || !name) return res.status(400).json({ error: 'Missing fields' });
    if (!['company','applicant'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (await DB.findUserByEmail(email)) return res.status(409).json({ error: 'Email already registered' });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await DB.createUser({ email, passwordHash, role, name });
    let profile;
    if (role === 'company') {
      profile = await DB.createCompany({ userId: user.id, name: companyName || name, website: website||'', location: companyLocation||'', description: description||'', logo:'' });
    } else {
      profile = await DB.createApplicant({ userId: user.id, fullName: name });
    }
    const token = jwt.sign({ id: user.id, email, role, name }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id:user.id, email, role, name }, profile });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await DB.findUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    if (!await bcrypt.compare(password, user.passwordHash)) return res.status(401).json({ error: 'Invalid credentials' });
    const profile = user.role === 'company' ? await DB.findCompanyByUserId(user.id) : await DB.findApplicantByUserId(user.id);
    const token = jwt.sign({ id:user.id, email, role:user.role, name:user.name }, JWT_SECRET, { expiresIn:'7d' });
    res.json({ token, user:{ id:user.id, email:user.email, role:user.role, name:user.name }, profile });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const user = await DB.findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const profile = user.role === 'company' ? await DB.findCompanyByUserId(user.id) : await DB.findApplicantByUserId(user.id);
    res.json({ user:{ id:user.id, email:user.email, role:user.role, name:user.name }, profile });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ── PUBLIC JOBS ──────────────────────────────────────────────────────────────
app.get('/api/jobs', async (req, res) => {
  try { res.json(await DB.getActiveJobs(req.query)); }
  catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const job = await DB.findJobById(req.params.id);
    if (!job || !job.isActive) return res.status(404).json({ error: 'Not found' });
    await DB.incrementJobView(job.id);
    const company = await DB.findCompanyById(job.companyId);
    res.json({ ...job, company: company ? { name:company.name, logo:company.logo, location:company.location, description:company.description, website:company.website } : {} });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ── COMPANY: PROFILE ─────────────────────────────────────────────────────────
app.get('/api/company/profile', auth, co, async (req, res) => {
  try { const c = await DB.findCompanyByUserId(req.user.id); res.json(c || {}); }
  catch(e) { res.status(500).json({ error: 'Server error' }); }
});
app.put('/api/company/profile', auth, co, async (req, res) => {
  try {
    const c = await DB.findCompanyByUserId(req.user.id);
    res.json(await DB.updateCompany(c.id, req.body));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});
app.post('/api/company/logo', auth, co, upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const c = await DB.findCompanyByUserId(req.user.id);
    await DB.updateCompany(c.id, { logo: `/uploads/${req.file.filename}` });
    res.json({ logo: `/uploads/${req.file.filename}` });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ── COMPANY: STATS / ANALYTICS ───────────────────────────────────────────────
app.get('/api/company/stats', auth, co, async (req, res) => {
  try {
    const c = await DB.findCompanyByUserId(req.user.id);
    res.json(await DB.getStats(c.id));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ── COMPANY: JOBS ────────────────────────────────────────────────────────────
app.get('/api/company/jobs', auth, co, async (req, res) => {
  try {
    const c = await DB.findCompanyByUserId(req.user.id);
    res.json(await DB.getJobsByCompany(c.id));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/company/jobs', auth, co, async (req, res) => {
  try {
    const c = await DB.findCompanyByUserId(req.user.id);
    const { title, department, location, type, level, salary, description, requirements, responsibilities, niceToHave, remote, screeningQuestions } = req.body;
    if (!title || !department || !location) return res.status(400).json({ error: 'Missing required fields' });
    const job = await DB.createJob({
      companyId: c.id, title, department, location,
      type: type||'Full-time', level: level||'Mid', salary: salary||'',
      description: description||'', requirements: requirements||[],
      responsibilities: responsibilities||[], niceToHave: niceToHave||[],
      remote: !!remote, screeningQuestions: screeningQuestions||[],
    });
    res.status(201).json(job);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/company/jobs/:id', auth, co, async (req, res) => {
  try {
    const c = await DB.findCompanyByUserId(req.user.id);
    const j = await DB.findJobById(req.params.id);
    if (!j || j.companyId.toString() !== c.id.toString()) return res.status(403).json({ error: 'Forbidden' });
    res.json(await DB.updateJob(j.id, req.body));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/company/jobs/:id', auth, co, async (req, res) => {
  try {
    const c = await DB.findCompanyByUserId(req.user.id);
    const j = await DB.findJobById(req.params.id);
    if (!j || j.companyId.toString() !== c.id.toString()) return res.status(403).json({ error: 'Forbidden' });
    await DB.deleteJob(j.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ── COMPANY: APPLICATIONS ────────────────────────────────────────────────────
app.get('/api/company/applications', auth, co, async (req, res) => {
  try {
    const c = await DB.findCompanyByUserId(req.user.id);
    res.json(await DB.getApplicationsByCompany(c.id, req.query.sort));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/company/jobs/:id/applications', auth, co, async (req, res) => {
  try {
    const c = await DB.findCompanyByUserId(req.user.id);
    const j = await DB.findJobById(req.params.id);
    if (!j || j.companyId.toString() !== c.id.toString()) return res.status(403).json({ error: 'Forbidden' });
    res.json(await DB.getApplicationsByJob(j.id, req.query.sort));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/company/applications/:id/status', auth, co, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['applied','reviewing','interviewing','offered','hired','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const updated = await DB.updateApplicationStatus(req.params.id, status);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/company/applications/:id', auth, co, async (req, res) => {
  try {
    const { notes, starred, interviewScheduledAt, interviewLink } = req.body;
    const updated = await DB.updateApplication(req.params.id, { notes, starred, interviewScheduledAt, interviewLink });
    res.json(updated);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ── AI: EVALUATE ONE APPLICATION ─────────────────────────────────────────────
app.post('/api/company/applications/:id/evaluate', auth, co, async (req, res) => {
  try {
    const application = await DB.findApplicationById(req.params.id);
    if (!application) return res.status(404).json({ error: 'Not found' });
    const job       = await DB.findJobById(application.jobId);
    const applicant = await DB.findApplicantById(application.applicantId);
    const user      = await DB.findUserById(applicant.userId);

    const prompt = buildEvalPrompt(job, applicant, application);
    const raw    = await callClaude([{ role:'user', content: prompt }], 1500);
    const result = parseJSON(raw);

    const scoreData = {
      aiScore:      result.overallScore,
      aiLabel:      scoreLabel(result.overallScore),
      aiEvaluation: {
        summary:         result.summary,
        strengths:       result.strengths,
        gaps:            result.gaps,
        skillsMatch:     result.skillsMatch,
        experienceMatch: result.experienceMatch,
        recommendation:  result.recommendation,
      },
      aiEvaluatedAt: new Date(),
    };
    const updated = await DB.updateApplication(application.id, scoreData);
    res.json(updated);
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── AI: BULK EVALUATE ALL FOR A JOB ─────────────────────────────────────────
app.post('/api/company/jobs/:id/evaluate-all', auth, co, async (req, res) => {
  try {
    const c = await DB.findCompanyByUserId(req.user.id);
    const j = await DB.findJobById(req.params.id);
    if (!j || j.companyId.toString() !== c.id.toString()) return res.status(403).json({ error: 'Forbidden' });

    const applications = await DB.getApplicationsByJob(j.id);
    if (!applications.length) return res.json({ evaluated: 0 });

    // Evaluate in parallel (max 5 at a time to avoid rate limits)
    const results = [];
    for (let i = 0; i < applications.length; i += 5) {
      const batch = applications.slice(i, i + 5);
      const batchResults = await Promise.allSettled(
        batch.map(async (appData) => {
          const applicant = await DB.findApplicantById(appData.applicantId);
          const prompt    = buildEvalPrompt(j, applicant, appData);
          const raw       = await callClaude([{ role:'user', content: prompt }], 1200);
          const result    = parseJSON(raw);
          return {
            id:     appData.id,
            aiScore: result.overallScore,
            aiLabel: scoreLabel(result.overallScore),
            aiEvaluation: {
              summary:         result.summary,
              strengths:       result.strengths,
              gaps:            result.gaps,
              skillsMatch:     result.skillsMatch,
              experienceMatch: result.experienceMatch,
              recommendation:  result.recommendation,
            },
          };
        })
      );
      batchResults.forEach(r => { if (r.status === 'fulfilled') results.push(r.value); });
    }

    await DB.bulkUpdateAiScores(results);
    res.json({ evaluated: results.length, results });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── AI: AUTO-SHORTLIST ───────────────────────────────────────────────────────
app.post('/api/company/jobs/:id/shortlist', auth, co, async (req, res) => {
  try {
    const { threshold = 70 } = req.body; // move to "reviewing" if score >= threshold
    const c = await DB.findCompanyByUserId(req.user.id);
    const j = await DB.findJobById(req.params.id);
    if (!j || j.companyId.toString() !== c.id.toString()) return res.status(403).json({ error: 'Forbidden' });
    const applications = await DB.getApplicationsByJob(j.id);
    const toShortlist  = applications.filter(a => a.aiScore >= threshold && a.status === 'applied');
    await Promise.all(toShortlist.map(a => DB.updateApplicationStatus(a.id, 'reviewing')));
    res.json({ shortlisted: toShortlist.length, threshold });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── COMPANY: TALENT POOL ─────────────────────────────────────────────────────
app.get('/api/company/talent-pool', auth, co, async (req, res) => {
  try {
    const c = await DB.findCompanyByUserId(req.user.id);
    const { q, skills, location } = req.query;
    const skillsArr = skills ? skills.split(',') : [];
    res.json(await DB.searchTalentPool(c.id, { q, skills: skillsArr, location }));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ── COMPANY: SCORECARDS ──────────────────────────────────────────────────────
app.get('/api/company/applications/:id/scorecards', auth, co, async (req, res) => {
  try { res.json(await DB.getScorecardsByApp(req.params.id)); }
  catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/company/applications/:id/scorecards', auth, co, async (req, res) => {
  try {
    const { scores, overallScore, recommendation, notes } = req.body;
    const sc = await DB.createScorecard({
      applicationId: req.params.id,
      reviewerId:    req.user.id,
      reviewerName:  req.user.name,
      scores, overallScore, recommendation, notes,
    });
    res.status(201).json(sc);
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ── AI: JOB DESCRIPTION GENERATOR ───────────────────────────────────────────
app.post('/api/ai/generate-jd', auth, co, async (req, res) => {
  try {
    const { title, department, level, type, location, salary, remote, companyName, companyDescription } = req.body;
    if (!title) return res.status(400).json({ error: 'Job title is required' });
    const prompt = `You are an expert recruiter. Write a compelling job description for this role.
Role: ${title} | Dept: ${department||''} | Level: ${level||'Mid'} | Type: ${type||'Full-time'} | Location: ${location||''}${remote?' (Remote-friendly)':''}${salary?` | Salary: ${salary}`:''}
${companyName?`Company: ${companyName}`:''}${companyDescription?`\nAbout company: ${companyDescription}`:''}

Return ONLY valid JSON (no markdown):
{"description":"3-4 sentence compelling overview","responsibilities":["action-oriented bullet 1","bullet 2","bullet 3","bullet 4","bullet 5"],"requirements":["requirement 1","requirement 2","requirement 3","requirement 4","requirement 5"],"niceToHave":["nice 1","nice 2","nice 3"],"salary":"${salary||'suggested range if not provided'}"}
Write in direct professional tone. No filler phrases.`;

    const raw  = await callClaude([{ role:'user', content: prompt }], 1500);
    res.json(parseJSON(raw));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AI: PARSE RESUME ─────────────────────────────────────────────────────────
app.post('/api/parse-resume', auth, upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileBuffer = fs.readFileSync(req.file.path);
    const base64     = fileBuffer.toString('base64');
    const isPdf      = path.extname(req.file.originalname).toLowerCase() === '.pdf';
    // Keep the file in uploads — do NOT delete it. Save it to the applicant profile.
    const resumePath = `/uploads/${req.file.filename}`;
    const resumeName = req.file.originalname;

    // Save resume file reference to profile immediately
    const ap = await DB.findApplicantByUserId(req.user.id);
    if (ap) {
      await DB.updateApplicant(ap.id, { resume: resumePath, resumeName });
    }

    const prompt = `Extract all information from this resume and return ONLY valid JSON (no markdown):
{"name":"","jtitle":"","email":"","phone":"","loc":"","linkedin":"","website":"","summary":"2-4 sentence summary","experience":[{"role":"","company":"","location":"","startDate":"","endDate":"","description":"","bullets":[]}],"education":[{"degree":"","field":"","school":"","location":"","startDate":"","endDate":""}],"skills":[],"certifications":[{"name":"","issuer":"","year":""}]}
Return empty strings/arrays for missing data. Do not invent information.`;

    const claudeContent = isPdf
      ? [{ type:'document', source:{ type:'base64', media_type:'application/pdf', data:base64 } }, { type:'text', text:prompt }]
      : [{ type:'text', text:`Resume:\n\n${fileBuffer.toString('utf8')}\n\n${prompt}` }];

    const raw    = await callClaude([{ role:'user', content: claudeContent }], 4000);
    const parsed = parseJSON(raw);

    // Return parsed data + file reference so frontend can update profile state
    res.json({ ...parsed, _resumePath: resumePath, _resumeName: resumeName });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── APPLICANT: PROFILE ───────────────────────────────────────────────────────
app.get('/api/applicant/profile', auth, app_, async (req, res) => {
  try {
    const ap   = await DB.findApplicantByUserId(req.user.id);
    const user = await DB.findUserById(req.user.id);
    res.json({ ...ap, email: user.email });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/applicant/profile', auth, app_, async (req, res) => {
  try {
    const ap = await DB.findApplicantByUserId(req.user.id);
    res.json(await DB.updateApplicant(ap.id, req.body));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/applicant/resume', auth, app_, upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const ap = await DB.findApplicantByUserId(req.user.id);
    await DB.updateApplicant(ap.id, { resume: `/uploads/${req.file.filename}`, resumeName: req.file.originalname });
    res.json({ resume: `/uploads/${req.file.filename}`, resumeName: req.file.originalname });
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ── APPLICANT: APPLY ─────────────────────────────────────────────────────────
app.post('/api/applicant/apply/:jobId', auth, app_, async (req, res) => {
  try {
    const ap  = await DB.findApplicantByUserId(req.user.id);
    if (!ap)   return res.status(404).json({ error: 'Profile not found' });
    const job = await DB.findJobById(req.params.jobId);
    if (!job || !job.isActive) return res.status(404).json({ error: 'Job not found' });
    if (await DB.hasApplied(job.id, ap.id)) return res.status(409).json({ error: 'Already applied' });

    const { coverLetter, screeningAnswers = [] } = req.body;

    // Process knockout questions
    let isKnockedOut = false;
    const processedAnswers = (job.screeningQuestions || []).map((q, i) => {
      const ans = screeningAnswers.find(a => a.questionId === q._id?.toString() || a.questionId === i.toString()) || {};
      const passed = q.knockout
        ? (ans.answer || '').toLowerCase().trim() === (q.knockoutAnswer || '').toLowerCase().trim()
        : true;
      if (q.knockout && !passed) isKnockedOut = true;
      return { question: q.question, answer: ans.answer || '', passed };
    });

    const application = await DB.createApplication({
      jobId: job.id, applicantId: ap.id,
      coverLetter: coverLetter||'', resume: ap.resume||'',
      screeningAnswers: processedAnswers, isKnockedOut,
      status: isKnockedOut ? 'rejected' : 'applied',
    });
    res.status(201).json(application);
  } catch(e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Already applied' });
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/applicant/applications', auth, app_, async (req, res) => {
  try {
    const ap = await DB.findApplicantByUserId(req.user.id);
    res.json(await DB.getApplicationsByApplicant(ap.id));
  } catch(e) { res.status(500).json({ error: 'Server error' }); }
});

// ── HELPERS ──────────────────────────────────────────────────────────────────
function scoreLabel(score) {
  if (score >= 80) return 'Strong Fit';
  if (score >= 60) return 'Good Fit';
  if (score >= 40) return 'Weak Fit';
  return 'Not a Fit';
}

function buildEvalPrompt(job, applicant, application) {
  const jdSummary = `
Title: ${job.title}
Level: ${job.level}
Department: ${job.department}
Location: ${job.location}
Description: ${job.description || ''}
Requirements:
${(job.requirements||[]).map(r => `- ${r}`).join('\n')}
Nice to have:
${(job.niceToHave||[]).map(r => `- ${r}`).join('\n')}`;

  const candidateSummary = `
Name: ${applicant?.fullName || 'Unknown'}
Bio: ${applicant?.bio || ''}
Skills: ${(applicant?.skills || []).join(', ')}
Location: ${applicant?.location || ''}
Cover Letter: ${application.coverLetter || 'None'}`;

  return `You are an expert technical recruiter. Evaluate this candidate against the job description.

JOB DESCRIPTION:
${jdSummary}

CANDIDATE PROFILE:
${candidateSummary}

Return ONLY valid JSON (no markdown):
{
  "overallScore": <number 0-100>,
  "skillsMatch": <number 0-100>,
  "experienceMatch": <number 0-100>,
  "summary": "<2-3 sentence honest evaluation>",
  "strengths": ["<specific strength 1>", "<strength 2>", "<strength 3>"],
  "gaps": ["<specific gap 1>", "<gap 2>"],
  "recommendation": "<Strong Fit|Good Fit|Weak Fit|Not a Fit>"
}
Be honest and specific. Base scores on actual evidence in the profile.`;
}


// ══════════════════════════════════════════════════════════════════════════════
//  PSYCHOMETRIC & EQ ASSESSMENTS
// ══════════════════════════════════════════════════════════════════════════════

// ── Built-in question banks ──────────────────────────────────────────────────
const STANDARD_SCALES = {
  never: ['Never','Rarely','Sometimes','Often','Always'],
  agree: ['Strongly Disagree','Disagree','Neutral','Agree','Strongly Agree'],
  freq:  ['Not at all like me','Slightly like me','Moderately like me','Mostly like me','Exactly like me'],
};

const opts = (scale) => STANDARD_SCALES[scale].map((label, i) => ({ label, value: i + 1 }));

const BIG5_QUESTIONS = [
  { text: 'I enjoy exploring new and complex ideas.', trait: 'Openness', reversed: false, options: opts('freq') },
  { text: 'I have a vivid imagination.', trait: 'Openness', reversed: false, options: opts('freq') },
  { text: 'I prefer routine and familiarity over novelty.', trait: 'Openness', reversed: true, options: opts('freq') },
  { text: 'I am curious about many different things.', trait: 'Openness', reversed: false, options: opts('freq') },
  { text: 'I find creative work like art or writing uninteresting.', trait: 'Openness', reversed: true, options: opts('freq') },
  { text: 'I always prepare carefully before starting a project.', trait: 'Conscientiousness', reversed: false, options: opts('freq') },
  { text: 'I pay close attention to detail.', trait: 'Conscientiousness', reversed: false, options: opts('freq') },
  { text: 'I often leave tasks unfinished.', trait: 'Conscientiousness', reversed: true, options: opts('freq') },
  { text: 'I follow through on my commitments.', trait: 'Conscientiousness', reversed: false, options: opts('freq') },
  { text: 'I tend to procrastinate on important tasks.', trait: 'Conscientiousness', reversed: true, options: opts('freq') },
  { text: 'I feel energised after spending time with a group of people.', trait: 'Extraversion', reversed: false, options: opts('freq') },
  { text: 'I enjoy being the centre of attention.', trait: 'Extraversion', reversed: false, options: opts('freq') },
  { text: 'I prefer to work alone rather than in a team.', trait: 'Extraversion', reversed: true, options: opts('freq') },
  { text: 'I find it easy to start conversations with strangers.', trait: 'Extraversion', reversed: false, options: opts('freq') },
  { text: 'I feel drained after extended social interactions.', trait: 'Extraversion', reversed: true, options: opts('freq') },
  { text: 'I enjoy helping others, even when it is inconvenient.', trait: 'Agreeableness', reversed: false, options: opts('freq') },
  { text: 'I am interested in other people and their feelings.', trait: 'Agreeableness', reversed: false, options: opts('freq') },
  { text: 'I sometimes put my own interests ahead of others.', trait: 'Agreeableness', reversed: true, options: opts('freq') },
  { text: 'I try to avoid conflict even when I disagree.', trait: 'Agreeableness', reversed: false, options: opts('freq') },
  { text: 'I prioritise results over relationships.', trait: 'Agreeableness', reversed: true, options: opts('freq') },
  { text: 'I worry about things that might go wrong.', trait: 'Neuroticism', reversed: false, options: opts('freq') },
  { text: 'I stay calm and composed under pressure.', trait: 'Neuroticism', reversed: true, options: opts('freq') },
  { text: 'I experience mood swings frequently.', trait: 'Neuroticism', reversed: false, options: opts('freq') },
  { text: 'I rarely feel anxious or stressed.', trait: 'Neuroticism', reversed: true, options: opts('freq') },
  { text: 'I find it hard to recover quickly from setbacks.', trait: 'Neuroticism', reversed: false, options: opts('freq') },
];
const EQ_QUESTIONS = [
  { text: 'I am aware of how my emotions affect my decisions.', trait: 'Self-Awareness', reversed: false, options: opts('agree') },
  { text: 'I can identify my emotions as I experience them.', trait: 'Self-Awareness', reversed: false, options: opts('agree') },
  { text: 'I understand my personal strengths and weaknesses.', trait: 'Self-Awareness', reversed: false, options: opts('agree') },
  { text: 'I am often surprised by my own emotional reactions.', trait: 'Self-Awareness', reversed: true, options: opts('agree') },
  { text: 'I can predict how I will feel in various situations.', trait: 'Self-Awareness', reversed: false, options: opts('agree') },
  { text: 'I can stay composed when I feel frustrated or upset.', trait: 'Self-Regulation', reversed: false, options: opts('agree') },
  { text: 'I think before acting when I am angry.', trait: 'Self-Regulation', reversed: false, options: opts('agree') },
  { text: 'I struggle to stay calm under prolonged stress.', trait: 'Self-Regulation', reversed: true, options: opts('agree') },
  { text: 'I can adapt my behaviour to different situations.', trait: 'Self-Regulation', reversed: false, options: opts('agree') },
  { text: 'I sometimes react impulsively in difficult conversations.', trait: 'Self-Regulation', reversed: true, options: opts('agree') },
  { text: 'I set ambitious goals and work hard to achieve them.', trait: 'Motivation', reversed: false, options: opts('agree') },
  { text: 'I maintain optimism even when facing challenges.', trait: 'Motivation', reversed: false, options: opts('agree') },
  { text: 'I feel driven by something beyond financial rewards.', trait: 'Motivation', reversed: false, options: opts('agree') },
  { text: 'Setbacks often make me want to give up.', trait: 'Motivation', reversed: true, options: opts('agree') },
  { text: 'I take initiative without being told what to do.', trait: 'Motivation', reversed: false, options: opts('agree') },
  { text: 'I can sense how others are feeling without them saying so.', trait: 'Empathy', reversed: false, options: opts('agree') },
  { text: 'I listen fully when someone shares their concerns.', trait: 'Empathy', reversed: false, options: opts('agree') },
  { text: 'I find it hard to relate to people very different from me.', trait: 'Empathy', reversed: true, options: opts('agree') },
  { text: 'I adjust how I communicate based on the person I am talking to.', trait: 'Empathy', reversed: false, options: opts('agree') },
  { text: 'I notice unspoken tensions in group settings.', trait: 'Empathy', reversed: false, options: opts('agree') },
  { text: 'I can easily build rapport with new people.', trait: 'Social Skills', reversed: false, options: opts('agree') },
  { text: 'I handle disagreements constructively.', trait: 'Social Skills', reversed: false, options: opts('agree') },
  { text: 'I inspire and motivate others around me.', trait: 'Social Skills', reversed: false, options: opts('agree') },
  { text: 'I find teamwork difficult when opinions differ strongly.', trait: 'Social Skills', reversed: true, options: opts('agree') },
  { text: 'I can influence others without relying on authority.', trait: 'Social Skills', reversed: false, options: opts('agree') },
];
const COGNITIVE_QUESTIONS = [
  { text: 'I enjoy breaking complex problems into smaller parts.', trait: 'Analytical Thinking', reversed: false, options: opts('agree') },
  { text: 'I look for evidence before drawing conclusions.', trait: 'Analytical Thinking', reversed: false, options: opts('agree') },
  { text: 'I prefer intuition over data when making decisions.', trait: 'Analytical Thinking', reversed: true, options: opts('agree') },
  { text: 'I enjoy working with numbers and logical sequences.', trait: 'Analytical Thinking', reversed: false, options: opts('agree') },
  { text: 'I often think of unconventional solutions to problems.', trait: 'Creative Thinking', reversed: false, options: opts('agree') },
  { text: 'I enjoy brainstorming many different ideas.', trait: 'Creative Thinking', reversed: false, options: opts('agree') },
  { text: 'I prefer tried-and-tested methods over new approaches.', trait: 'Creative Thinking', reversed: true, options: opts('agree') },
  { text: 'I make connections between seemingly unrelated concepts.', trait: 'Creative Thinking', reversed: false, options: opts('agree') },
  { text: 'I question assumptions before accepting them.', trait: 'Critical Thinking', reversed: false, options: opts('agree') },
  { text: 'I evaluate multiple perspectives before deciding.', trait: 'Critical Thinking', reversed: false, options: opts('agree') },
  { text: 'I tend to accept information at face value.', trait: 'Critical Thinking', reversed: true, options: opts('agree') },
  { text: 'I can make confident decisions under uncertainty.', trait: 'Decision Making', reversed: false, options: opts('agree') },
  { text: 'I weigh the long-term consequences of my choices.', trait: 'Decision Making', reversed: false, options: opts('agree') },
  { text: 'I often second-guess decisions I have already made.', trait: 'Decision Making', reversed: true, options: opts('agree') },
  { text: 'I quickly adapt when my approach is not working.', trait: 'Learning Agility', reversed: false, options: opts('agree') },
  { text: 'I actively seek feedback to improve myself.', trait: 'Learning Agility', reversed: false, options: opts('agree') },
  { text: 'I find it hard to change my approach once committed.', trait: 'Learning Agility', reversed: true, options: opts('agree') },
];
const QUESTION_BANKS = { big5: BIG5_QUESTIONS, eq: EQ_QUESTIONS, cognitive: COGNITIVE_QUESTIONS };

// ── SCORING ──────────────────────────────────────────────────────────────────
function scoreAssessment(questions, answers) {
  const traitSums = {}, traitCounts = {};
  const answerMap = Object.fromEntries(answers.map(a => [a.questionId, a.value]));

  questions.forEach(q => {
    const qId  = q._id?.toString() || q.id;
    const raw  = answerMap[qId];
    if (raw === undefined || raw === null) return;
    const val  = q.reversed ? (6 - raw) : raw;
    if (!traitSums[q.trait]) { traitSums[q.trait] = 0; traitCounts[q.trait] = 0; }
    traitSums[q.trait]   += val;
    traitCounts[q.trait] += 1;
  });

  const scores = {};
  for (const trait of Object.keys(traitSums)) {
    const avg = traitSums[trait] / traitCounts[trait];
    scores[trait] = Math.round(((avg - 1) / 4) * 100); // normalise 1-5 → 0-100
  }
  return scores;
}

function traitLabel(score) {
  if (score >= 80) return 'Very High';
  if (score >= 65) return 'High';
  if (score >= 45) return 'Moderate';
  if (score >= 30) return 'Low';
  return 'Very Low';
}

// ── COMPANY: LIST / CREATE ASSESSMENTS ───────────────────────────────────────
app.get('/api/company/assessments', auth, co, async (req, res) => {
  try {
    const c = await DB.findCompanyByUserId(req.user.id);
    res.json(await DB.getAssessmentsByCompany(c.id));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/company/assessments', auth, co, async (req, res) => {
  try {
    const c = await DB.findCompanyByUserId(req.user.id);
    const { title, type, description, timeLimit, useStandard } = req.body;
    if (!title || !type) return res.status(400).json({ error: 'title and type required' });

    const questions = useStandard !== false
      ? (QUESTION_BANKS[type] || [])
      : (req.body.questions || []);

    const assessment = await DB.createAssessment({
      companyId: c.id, title, type, description: description||'',
      timeLimit: timeLimit || 20, questions,
    });
    res.status(201).json(assessment);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/company/assessments/:id', auth, co, async (req, res) => {
  try {
    const a = await DB.findAssessmentById(req.params.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    res.json(a);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/company/assessments/:id', auth, co, async (req, res) => {
  try {
    await DB.deleteAssessment(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── COMPANY: SEND INVITE ──────────────────────────────────────────────────────
app.post('/api/company/assessments/:id/invite', auth, co, async (req, res) => {
  try {
    const c   = await DB.findCompanyByUserId(req.user.id);
    const aId = req.params.id;
    const { applicationId } = req.body;
    if (!applicationId) return res.status(400).json({ error: 'applicationId required' });

    const application = await DB.findApplicationById(applicationId);
    if (!application) return res.status(404).json({ error: 'Application not found' });

    const { v4: uuid } = require('uuid');
    const token = uuid() + '-' + uuid(); // long unique token

    const invite = await DB.createInvite({
      assessmentId:  aId,
      applicantId:   application.applicantId,
      applicationId: applicationId,
      jobId:         application.jobId,
      companyId:     c.id,
      token,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000), // 7 days
    });

    // Return invite URL for the company to share
    const inviteUrl = `${req.protocol}://${req.get('host')}/assessment/${token}`;
    res.status(201).json({ ...invite, inviteUrl });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── COMPANY: VIEW ALL RESULTS ─────────────────────────────────────────────────
app.get('/api/company/assessment-results', auth, co, async (req, res) => {
  try {
    const c = await DB.findCompanyByUserId(req.user.id);
    res.json(await DB.getInvitesByCompany(c.id));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/company/applications/:id/assessments', auth, co, async (req, res) => {
  try {
    res.json(await DB.getInvitesByApplication(req.params.id));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AI: GENERATE REPORT FOR COMPLETED ASSESSMENT ─────────────────────────────
app.post('/api/company/invites/:id/report', auth, co, async (req, res) => {
  try {
    const invite = await DB.findInviteById(req.params.id);
    if (!invite || invite.status !== 'completed') return res.status(400).json({ error: 'Assessment not completed yet' });

    const assessment  = await DB.findAssessmentById(invite.assessmentId);
    const applicant   = await DB.findApplicantById(invite.applicantId);
    const scores      = invite.scores || {};
    const traitLines  = Object.entries(scores).map(([t, s]) => `- ${t}: ${s}/100 (${traitLabel(s)})`).join('\n');

    const typeDesc = { big5:'Big Five Personality', eq:'Emotional Intelligence', cognitive:'Cognitive Style', custom:'Custom' }[assessment.type] || assessment.type;

    const prompt = `You are an expert occupational psychologist. Interpret these ${typeDesc} assessment results for a candidate.

Candidate: ${applicant?.fullName || 'Candidate'}
Assessment: ${assessment.title} (${typeDesc})
Trait Scores (0-100):
${traitLines}

Return ONLY valid JSON (no markdown):
{
  "summary": "2-3 sentence executive summary of this candidate's psychological profile",
  "traitProfiles": [
    { "trait": "TraitName", "score": <number>, "label": "${['Very Low','Low','Moderate','High','Very High'].join('|')}", "description": "2-sentence specific behavioural description of what this score means for this person in a work context" }
  ],
  "strengths": ["3-5 specific professional strengths derived from the scores"],
  "developmentAreas": ["2-3 specific areas to develop, framed constructively"],
  "workStyleSummary": "Paragraph describing how this person works best — environment, collaboration style, decision-making approach",
  "fitForRole": "Assessment of what types of roles and teams this person would thrive in",
  "recommendedFor": ["3-4 specific role types or environments where this profile excels"]
}
Base all interpretations on the actual scores. Be specific and insightful, not generic.`;

    const raw    = await callClaude([{ role:'user', content: prompt }], 2000);
    const report = parseJSON(raw);

    const updated = await DB.updateInvite(invite.id, {
      aiReport: report,
      aiReportGeneratedAt: new Date(),
    });
    res.json(updated);
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── PUBLIC: TAKE ASSESSMENT (by token) ───────────────────────────────────────
// Get assessment by token (no auth — public link)
app.get('/api/assessment/:token', async (req, res) => {
  try {
    const invite = await DB.findInviteByToken(req.params.token);
    if (!invite) return res.status(404).json({ error: 'Invalid or expired link' });
    if (invite.status === 'expired' || (invite.expiresAt && new Date() > new Date(invite.expiresAt)))
      return res.status(410).json({ error: 'This assessment link has expired' });
    if (invite.status === 'completed')
      return res.status(200).json({ ...invite, alreadyCompleted: true });

    const assessment = await DB.findAssessmentById(invite.assessmentId);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    // Strip correct answers from questions — send clean questions
    const questions = assessment.questions.map(q => ({
      id:      q._id?.toString() || q.id,
      text:    q.text,
      trait:   q.trait,
      options: q.options,
    }));

    res.json({ invite, assessment: { ...assessment, questions }, alreadyCompleted: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Start assessment
app.post('/api/assessment/:token/start', async (req, res) => {
  try {
    const invite = await DB.findInviteByToken(req.params.token);
    if (!invite || invite.status === 'completed') return res.status(400).json({ error: 'Invalid' });
    await DB.updateInvite(invite.id, { status: 'in_progress', startedAt: new Date() });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Submit answers
app.post('/api/assessment/:token/submit', async (req, res) => {
  try {
    const invite = await DB.findInviteByToken(req.params.token);
    if (!invite) return res.status(404).json({ error: 'Not found' });
    if (invite.status === 'completed') return res.status(409).json({ error: 'Already submitted' });

    const assessment = await DB.findAssessmentById(invite.assessmentId);
    const { answers } = req.body; // [{ questionId, value }]
    const scores = scoreAssessment(assessment.questions, answers);

    await DB.updateInvite(invite.id, {
      answers, scores, status: 'completed', completedAt: new Date(),
    });
    res.json({ ok: true, scores });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── APPLICANT: GET MY ASSESSMENTS ────────────────────────────────────────────
app.get('/api/applicant/assessments', auth, app_, async (req, res) => {
  try {
    const ap = await DB.findApplicantByUserId(req.user.id);
    res.json(await DB.getInvitesByApplicant(ap.id));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── SPA FALLBACK ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  // Assessment pages served from assessment.html
  if (req.path.startsWith('/assessment/')) {
    return res.sendFile(path.join(__dirname, 'public', 'assessment.html'));
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await DB.connect();
  app.listen(PORT, () => console.log(`🚀 NovaTalent → http://localhost:${PORT}`));
}
start().catch(err => { console.error('❌', err); process.exit(1); });
module.exports = app;