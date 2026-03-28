// FILE: database.js
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/novatalent';

async function connect() {
  if (mongoose.connection.readyState >= 1) return;
  await mongoose.connect(MONGO_URI);
  console.log(`✅ MongoDB connected → ${MONGO_URI}`);
}

// ── SCHEMAS ─────────────────────────────────────────────────────────────────

const UserSchema = new mongoose.Schema({
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role:         { type: String, enum: ['company', 'applicant'], required: true },
  name:         { type: String, required: true },
}, { timestamps: true });

const CompanySchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  name:        { type: String, required: true },
  website:     { type: String, default: '' },
  location:    { type: String, default: '' },
  description: { type: String, default: '' },
  logo:        { type: String, default: '' },
  industry:    { type: String, default: '' },
  size:        { type: String, default: '' }, // e.g. "10-50", "50-200"
}, { timestamps: true });

const ApplicantSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  fullName:   { type: String, default: '' },
  phone:      { type: String, default: '' },
  linkedin:   { type: String, default: '' },
  website:    { type: String, default: '' },
  jobTitle:   { type: String, default: '' },
  resume:     { type: String, default: '' },
  resumeName: { type: String, default: '' },
  resumeText: { type: String, default: '' },
  bio:        { type: String, default: '' },
  skills:     { type: [String], default: [] },
  location:   { type: String, default: '' },
  experience: { type: String, default: '' },
  // Full structured resume from builder
  resumeData: { type: mongoose.Schema.Types.Mixed, default: null },
  jobAlerts:  [{
    dept:     String,
    location: String,
    type:     String,
    active:   { type: Boolean, default: true },
  }],
}, { timestamps: true });

const ScreeningQuestionSchema = new mongoose.Schema({
  question: { type: String, required: true },
  type:     { type: String, enum: ['text', 'yesno', 'number'], default: 'text' },
  required: { type: Boolean, default: true },
  knockout: { type: Boolean, default: false }, // if true + answered wrong → auto-reject
  knockoutAnswer: { type: String, default: '' }, // expected answer for pass
}, { _id: true });

const JobSchema = new mongoose.Schema({
  companyId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  title:              { type: String, required: true },
  department:         { type: String, required: true },
  location:           { type: String, required: true },
  type:               { type: String, default: 'Full-time' },
  level:              { type: String, default: 'Mid' },
  salary:             { type: String, default: '' },
  description:        { type: String, default: '' },
  responsibilities:   { type: [String], default: [] },
  requirements:       { type: [String], default: [] },
  niceToHave:         { type: [String], default: [] },
  remote:             { type: Boolean, default: false },
  isActive:           { type: Boolean, default: true },
  screeningQuestions: { type: [ScreeningQuestionSchema], default: [] },
  viewCount:          { type: Number, default: 0 },
}, { timestamps: true });

const ScorecardSchema = new mongoose.Schema({
  applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true },
  reviewerId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reviewerName:  { type: String, default: '' },
  scores: [{
    category: String, // e.g. "Technical Skills", "Communication", "Culture Fit"
    score:    Number, // 1-5
    notes:    String,
  }],
  overallScore:    { type: Number, default: 0 }, // 1-5
  recommendation:  { type: String, enum: ['strong_yes', 'yes', 'neutral', 'no', 'strong_no'], default: 'neutral' },
  notes:           { type: String, default: '' },
}, { timestamps: true });

const ApplicationSchema = new mongoose.Schema({
  jobId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
  applicantId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Applicant', required: true },
  coverLetter:     { type: String, default: '' },
  resume:          { type: String, default: '' },
  status:          { type: String, enum: ['applied','reviewing','interviewing','offered','hired','rejected'], default: 'applied' },
  screeningAnswers:[{ question: String, answer: String, passed: Boolean }],
  isKnockedOut:    { type: Boolean, default: false },
  // AI Evaluation
  aiScore:         { type: Number, default: null }, // 0-100
  aiLabel:         { type: String, default: null }, // "Strong Fit" | "Good Fit" | "Weak Fit" | "Not a Fit"
  aiEvaluation: {
    summary:        String,
    strengths:      [String],
    gaps:           [String],
    skillsMatch:    Number, // 0-100
    experienceMatch:Number, // 0-100
    recommendation: String,
  },
  aiEvaluatedAt:   { type: Date, default: null },
  appliedAt:       { type: Date, default: Date.now },
  updatedAt:       { type: Date },
  // Interview scheduling
  interviewScheduledAt: { type: Date, default: null },
  interviewLink:        { type: String, default: '' },
  // Internal notes
  notes:           { type: String, default: '' },
  starred:         { type: Boolean, default: false },
}, { timestamps: true });

ApplicationSchema.index({ jobId: 1, applicantId: 1 }, { unique: true });
ApplicationSchema.index({ jobId: 1, aiScore: -1 });

// ── MODELS ──────────────────────────────────────────────────────────────────
const User        = mongoose.model('User',        UserSchema);
const Company     = mongoose.model('Company',     CompanySchema);
const Applicant   = mongoose.model('Applicant',   ApplicantSchema);
const Job         = mongoose.model('Job',         JobSchema);
const Application = mongoose.model('Application', ApplicationSchema);
const Scorecard   = mongoose.model('Scorecard',   ScorecardSchema);

// ── SERIALIZE ────────────────────────────────────────────────────────────────
function s(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  obj.id = (obj._id || obj.id).toString();
  delete obj._id; delete obj.__v;
  for (const k of Object.keys(obj)) {
    if (obj[k] instanceof mongoose.Types.ObjectId) obj[k] = obj[k].toString();
  }
  return obj;
}

function lean(doc) {
  if (!doc) return null;
  const obj = { ...doc };
  obj.id = (obj._id || obj.id).toString();
  delete obj._id; delete obj.__v;
  for (const k of Object.keys(obj)) {
    if (obj[k] instanceof mongoose.Types.ObjectId) obj[k] = obj[k].toString();
  }
  return obj;
}

// ── DB API ───────────────────────────────────────────────────────────────────
const DB = {
  connect,
  User, Company, Applicant, Job, Application, Scorecard,

  // USERS
  async createUser(data)          { return s(await User.create(data)); },
  async findUserByEmail(email)    { return s(await User.findOne({ email: email.toLowerCase() })); },
  async findUserById(id)          { try { return s(await User.findById(id)); } catch { return null; } },

  // COMPANIES
  async createCompany(data)           { return s(await Company.create(data)); },
  async findCompanyByUserId(userId)   { return s(await Company.findOne({ userId })); },
  async findCompanyById(id)           { try { return s(await Company.findById(id)); } catch { return null; } },
  async updateCompany(id, data)       { return s(await Company.findByIdAndUpdate(id, { $set: data }, { new: true })); },

  // APPLICANTS
  async createApplicant(data)         { return s(await Applicant.create(data)); },
  async findApplicantByUserId(userId) { return s(await Applicant.findOne({ userId })); },
  async findApplicantById(id)         { try { return s(await Applicant.findById(id)); } catch { return null; } },
  async updateApplicant(id, data)     { return s(await Applicant.findByIdAndUpdate(id, { $set: data }, { new: true })); },

  // Talent pool search
  async searchTalentPool(companyId, { q, skills, location } = {}) {
    // Find applicants who applied to any of this company's jobs
    const jobs       = await Job.find({ companyId }).lean();
    const jobIds     = jobs.map(j => j._id);
    const apps       = await Application.find({ jobId: { $in: jobIds } }).lean();
    const appIds     = [...new Set(apps.map(a => a.applicantId.toString()))];

    const query = { _id: { $in: appIds } };
    if (q) query.$or = [
      { fullName: { $regex: q, $options: 'i' } },
      { bio: { $regex: q, $options: 'i' } },
      { skills: { $regex: q, $options: 'i' } },
    ];
    if (skills?.length) query.skills = { $in: skills };
    if (location) query.location = { $regex: location, $options: 'i' };

    const applicants = await Applicant.find(query).lean();
    const userIds    = applicants.map(a => a.userId);
    const users      = await User.find({ _id: { $in: userIds } }).lean();
    const uMap       = Object.fromEntries(users.map(u => [u._id.toString(), u]));

    return applicants.map(a => {
      const user = uMap[a.userId.toString()];
      const appList = apps.filter(ap => ap.applicantId.toString() === a._id.toString());
      const bestScore = Math.max(...appList.map(ap => ap.aiScore || 0), 0);
      return { ...lean(a), email: user?.email, bestAiScore: bestScore, applicationCount: appList.length };
    });
  },

  // JOBS
  async createJob(data)   { return s(await Job.create(data)); },
  async findJobById(id)   { try { return s(await Job.findById(id)); } catch { return null; } },
  async incrementJobView(id) {
    try { await Job.findByIdAndUpdate(id, { $inc: { viewCount: 1 } }); } catch {}
  },
  async getActiveJobs(filters = {}) {
    const query = { isActive: true };
    if (filters.dept)     query.department = filters.dept;
    if (filters.type)     query.type = filters.type;
    if (filters.location) query.location = { $regex: filters.location, $options: 'i' };
    if (filters.q)        query.$or = [
      { title:       { $regex: filters.q, $options: 'i' } },
      { description: { $regex: filters.q, $options: 'i' } },
    ];
    const jobs      = await Job.find(query).sort({ createdAt: -1 }).lean();
    const compIds   = [...new Set(jobs.map(j => j.companyId.toString()))];
    const companies = await Company.find({ _id: { $in: compIds } }).lean();
    const cMap      = Object.fromEntries(companies.map(c => [c._id.toString(), c]));
    return jobs.map(j => {
      const c = cMap[j.companyId.toString()];
      return { ...lean(j), company: c ? { name: c.name, logo: c.logo, location: c.location, description: c.description, website: c.website } : {} };
    });
  },
  async getJobsByCompany(companyId) {
    const jobs   = await Job.find({ companyId }).sort({ createdAt: -1 }).lean();
    const jobIds = jobs.map(j => j._id);
    const counts = await Application.aggregate([
      { $match: { jobId: { $in: jobIds } } },
      { $group: { _id: '$jobId', count: { $sum: 1 }, newCount: { $sum: { $cond: [{ $eq: ['$status','applied'] }, 1, 0] } } } },
    ]);
    const cMap = Object.fromEntries(counts.map(a => [a._id.toString(), a]));
    return jobs.map(j => ({
      ...lean(j),
      applicationCount: cMap[j._id.toString()]?.count || 0,
      newApplicationCount: cMap[j._id.toString()]?.newCount || 0,
    }));
  },
  async updateJob(id, data)  { try { return s(await Job.findByIdAndUpdate(id, { $set: data }, { new: true })); } catch { return null; } },
  async deleteJob(id)        { await Job.findByIdAndDelete(id); },

  // APPLICATIONS
  async createApplication(data)  { return s(await Application.create(data)); },
  async hasApplied(jobId, applicantId) { return !!(await Application.findOne({ jobId, applicantId })); },
  async findApplicationById(id)  { try { return s(await Application.findById(id)); } catch { return null; } },

  async getApplicationsByApplicant(applicantId) {
    const apps   = await Application.find({ applicantId }).sort({ appliedAt: -1 }).lean();
    const jobIds = apps.map(a => a.jobId);
    const jobs   = await Job.find({ _id: { $in: jobIds } }).lean();
    const compIds = [...new Set(jobs.map(j => j.companyId.toString()))];
    const comps  = await Company.find({ _id: { $in: compIds } }).lean();
    const jMap   = Object.fromEntries(jobs.map(j => [j._id.toString(), j]));
    const cMap   = Object.fromEntries(comps.map(c => [c._id.toString(), c]));
    return apps.map(a => {
      const job = jMap[a.jobId.toString()];
      const co  = job ? cMap[job.companyId.toString()] : null;
      return { ...lean(a), job: job ? lean(job) : {}, company: co ? { name: co.name, logo: co.logo } : {} };
    });
  },

  async getApplicationsByJob(jobId, sort = 'date') {
    const sortMap = { date: { appliedAt: -1 }, score: { aiScore: -1 }, status: { status: 1 } };
    const apps       = await Application.find({ jobId }).sort(sortMap[sort] || sortMap.date).lean();
    const appIds     = apps.map(a => a.applicantId);
    const applicants = await Applicant.find({ _id: { $in: appIds } }).lean();
    const userIds    = applicants.map(a => a.userId);
    const users      = await User.find({ _id: { $in: userIds } }).lean();
    const apMap      = Object.fromEntries(applicants.map(a => [a._id.toString(), a]));
    const uMap       = Object.fromEntries(users.map(u => [u._id.toString(), u]));

    // Attach scorecards
    const appMongoIds = apps.map(a => a._id);
    const scorecards  = await Scorecard.find({ applicationId: { $in: appMongoIds } }).lean();
    const scMap = {};
    scorecards.forEach(sc => {
      const key = sc.applicationId.toString();
      if (!scMap[key]) scMap[key] = [];
      scMap[key].push(sc);
    });

    return apps.map(a => {
      const ap  = apMap[a.applicantId.toString()] || {};
      const usr = ap.userId ? uMap[ap.userId.toString()] : null;
      return {
        ...lean(a),
        applicant: { ...lean(ap), email: usr?.email },
        scorecards: (scMap[a._id.toString()] || []).map(sc => lean(sc)),
      };
    });
  },

  async getApplicationsByCompany(companyId, sort = 'date') {
    const jobs   = await Job.find({ companyId }).lean();
    const jobIds = jobs.map(j => j._id);
    const jMap   = Object.fromEntries(jobs.map(j => [j._id.toString(), j]));
    const sortMap = { date: { appliedAt: -1 }, score: { aiScore: -1 }, status: { status: 1 } };
    const apps   = await Application.find({ jobId: { $in: jobIds } }).sort(sortMap[sort] || sortMap.date).lean();
    const appIds = apps.map(a => a.applicantId);
    const aps    = await Applicant.find({ _id: { $in: appIds } }).lean();
    const uIds   = aps.map(a => a.userId);
    const users  = await User.find({ _id: { $in: uIds } }).lean();
    const apMap  = Object.fromEntries(aps.map(a => [a._id.toString(), a]));
    const uMap   = Object.fromEntries(users.map(u => [u._id.toString(), u]));
    return apps.map(a => {
      const ap  = apMap[a.applicantId.toString()] || {};
      const usr = ap.userId ? uMap[ap.userId.toString()] : null;
      const job = jMap[a.jobId.toString()] || {};
      return { ...lean(a), job: lean(job), applicant: { ...lean(ap), email: usr?.email } };
    });
  },

  async updateApplicationStatus(id, status) {
    try { return s(await Application.findByIdAndUpdate(id, { $set: { status, updatedAt: new Date() } }, { new: true })); }
    catch { return null; }
  },
  async updateApplication(id, data) {
    try { return s(await Application.findByIdAndUpdate(id, { $set: data }, { new: true })); }
    catch { return null; }
  },
  async bulkUpdateAiScores(updates) {
    // updates: [{id, aiScore, aiLabel, aiEvaluation}]
    const ops = updates.map(u => ({
      updateOne: {
        filter: { _id: u.id },
        update: { $set: { aiScore: u.aiScore, aiLabel: u.aiLabel, aiEvaluation: u.aiEvaluation, aiEvaluatedAt: new Date() } },
      },
    }));
    if (ops.length) await Application.bulkWrite(ops);
  },

  // STATS
  async getStats(companyId) {
    const jobs   = await Job.find({ companyId }).lean();
    const jobIds = jobs.map(j => j._id);
    const apps   = await Application.find({ jobId: { $in: jobIds } }).lean();
    const by = (st) => apps.filter(a => a.status === st).length;

    // Pipeline funnel
    const funnel = { applied: by('applied'), reviewing: by('reviewing'), interviewing: by('interviewing'), offered: by('offered'), hired: by('hired'), rejected: by('rejected') };

    // Avg time-to-hire (days from appliedAt to updatedAt for hired apps)
    const hiredApps = apps.filter(a => a.status === 'hired' && a.updatedAt);
    const avgTimeToHire = hiredApps.length
      ? Math.round(hiredApps.reduce((sum, a) => sum + (new Date(a.updatedAt) - new Date(a.appliedAt)) / 86400000, 0) / hiredApps.length)
      : null;

    // Applications per day (last 14 days)
    const now = Date.now();
    const trend = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(now - (13 - i) * 86400000);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const count = apps.filter(a => {
        const ad = new Date(a.appliedAt);
        return ad.toDateString() === d.toDateString();
      }).length;
      return { label, count };
    });

    // AI score distribution
    const scored = apps.filter(a => a.aiScore !== null);
    const scoreDistribution = { strong: 0, good: 0, weak: 0, none: 0 };
    scored.forEach(a => {
      if (a.aiScore >= 75) scoreDistribution.strong++;
      else if (a.aiScore >= 50) scoreDistribution.good++;
      else scoreDistribution.weak++;
    });
    scoreDistribution.none = apps.length - scored.length;

    // Top jobs by applications
    const jobAppCounts = {};
    apps.forEach(a => { jobAppCounts[a.jobId.toString()] = (jobAppCounts[a.jobId.toString()] || 0) + 1; });
    const topJobs = jobs
      .map(j => ({ title: j.title, count: jobAppCounts[j._id.toString()] || 0 }))
      .sort((a, b) => b.count - a.count).slice(0, 5);

    return {
      totalJobs: jobs.length,
      activeJobs: jobs.filter(j => j.isActive).length,
      totalApplications: apps.length,
      newApplications: by('applied'),
      interviewing: by('interviewing'),
      offered: by('offered'),
      hired: by('hired'),
      rejected: by('rejected'),
      avgTimeToHire,
      trend,
      funnel,
      scoreDistribution,
      topJobs,
      totalViews: jobs.reduce((s, j) => s + (j.viewCount || 0), 0),
    };
  },

  // SCORECARDS
  async createScorecard(data)  { return s(await Scorecard.create(data)); },
  async getScorecardsByApp(applicationId) {
    const cards = await Scorecard.find({ applicationId }).lean();
    return cards.map(lean);
  },
  async updateScorecard(id, data) {
    return s(await Scorecard.findByIdAndUpdate(id, { $set: data }, { new: true, upsert: false }));
  },
  async deleteScorecard(id) { await Scorecard.findByIdAndDelete(id); },

  // ASSESSMENTS
  async createAssessment(data)       { return s(await Assessment.create(data)); },
  async findAssessmentById(id)       { try { return s(await Assessment.findById(id)); } catch { return null; } },
  async getAssessmentsByCompany(cId) {
    const inviteCount = {};
    const invites = await AssessmentInvite.find({ companyId: cId }).lean();
    invites.forEach(i => { inviteCount[i.assessmentId.toString()] = (inviteCount[i.assessmentId.toString()]||0)+1; });
    return (await Assessment.find({ companyId: cId }).sort({ createdAt: -1 }).lean()).map(a => ({
      ...lean(a), inviteCount: inviteCount[a._id.toString()]||0
    }));
  },
  async updateAssessment(id, data)   { return s(await Assessment.findByIdAndUpdate(id, { $set: data }, { new: true })); },
  async deleteAssessment(id)         { await Assessment.findByIdAndDelete(id); },

  // INVITES
  async createInvite(data)     { return s(await AssessmentInvite.create(data)); },
  async findInviteByToken(tok) { return s(await AssessmentInvite.findOne({ token: tok })); },
  async findInviteById(id)     { try { return s(await AssessmentInvite.findById(id)); } catch { return null; } },
  async updateInvite(id, data) { return s(await AssessmentInvite.findByIdAndUpdate(id, { $set: data }, { new: true })); },
  async getInvitesByApplication(applicationId) {
    const invites = await AssessmentInvite.find({ applicationId }).lean();
    const aIds = invites.map(i => i.assessmentId);
    const assessments = await Assessment.find({ _id: { $in: aIds } }).lean();
    const aMap = Object.fromEntries(assessments.map(a => [a._id.toString(), a]));
    return invites.map(i => ({ ...lean(i), assessment: lean(aMap[i.assessmentId.toString()]) || {} }));
  },
  async getInvitesByApplicant(applicantId) {
    const invites = await AssessmentInvite.find({ applicantId }).lean();
    const aIds = invites.map(i => i.assessmentId);
    const jIds = invites.map(i => i.jobId).filter(Boolean);
    const [assessments, jobs] = await Promise.all([
      Assessment.find({ _id: { $in: aIds } }).lean(),
      Job.find({ _id: { $in: jIds } }).lean(),
    ]);
    const aMap = Object.fromEntries(assessments.map(a => [a._id.toString(), a]));
    const jMap = Object.fromEntries(jobs.map(j => [j._id.toString(), j]));
    return invites.map(i => ({
      ...lean(i),
      assessment: lean(aMap[i.assessmentId.toString()]) || {},
      job: lean(jMap[i.jobId?.toString()]) || {},
    }));
  },
  async getInvitesByCompany(companyId) {
    const jobs    = await Job.find({ companyId }).lean();
    const jobIds  = jobs.map(j => j._id);
    const invites = await AssessmentInvite.find({ companyId }).lean();
    const aIds    = [...new Set(invites.map(i => i.assessmentId.toString()))];
    const apIds   = [...new Set(invites.map(i => i.applicantId.toString()))];
    const [assessments, applicants] = await Promise.all([
      Assessment.find({ _id: { $in: aIds } }).lean(),
      Applicant.find({ _id: { $in: apIds } }).lean(),
    ]);
    const aMap  = Object.fromEntries(assessments.map(a => [a._id.toString(), a]));
    const apMap = Object.fromEntries(applicants.map(a => [a._id.toString(), a]));
    const jMap  = Object.fromEntries(jobs.map(j => [j._id.toString(), j]));
    return invites.map(i => ({
      ...lean(i),
      assessment: lean(aMap[i.assessmentId.toString()]) || {},
      applicant:  lean(apMap[i.applicantId.toString()]) || {},
      job:        lean(jMap[i.jobId?.toString()]) || {},
    }));
  },
};

// ── PSYCHOMETRIC SCHEMAS ──────────────────────────────────────────────────────

const QuestionSchema = new mongoose.Schema({
  text:     { type: String, required: true },
  trait:    { type: String, required: true },
  reversed: { type: Boolean, default: false },
  options:  [{ label: String, value: Number }],
}, { _id: true });

const AssessmentSchema = new mongoose.Schema({
  companyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  title:       { type: String, required: true },
  type:        { type: String, enum: ['big5', 'eq', 'cognitive', 'custom'], required: true },
  description: { type: String, default: '' },
  timeLimit:   { type: Number, default: 20 },
  questions:   { type: [QuestionSchema], default: [] },
  isActive:    { type: Boolean, default: true },
}, { timestamps: true });

const AssessmentInviteSchema = new mongoose.Schema({
  assessmentId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Assessment', required: true },
  applicantId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Applicant',  required: true },
  applicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
  jobId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
  companyId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  token:         { type: String, required: true, unique: true },
  status:        { type: String, enum: ['pending','in_progress','completed','expired'], default: 'pending' },
  startedAt:     { type: Date },
  completedAt:   { type: Date },
  expiresAt:     { type: Date },
  answers:       [{ questionId: String, value: Number }],
  scores:        { type: mongoose.Schema.Types.Mixed, default: {} },
  aiReport: {
    summary:          String,
    traitProfiles:    [{ trait: String, score: Number, label: String, description: String }],
    strengths:        [String],
    developmentAreas: [String],
    workStyleSummary: String,
    fitForRole:       String,
    recommendedFor:   [String],
  },
  aiReportGeneratedAt: Date,
}, { timestamps: true });

const Assessment       = mongoose.model('Assessment',        AssessmentSchema);
const AssessmentInvite = mongoose.model('AssessmentInvite',  AssessmentInviteSchema);
DB.Assessment       = Assessment;
DB.AssessmentInvite = AssessmentInvite;

module.exports = DB;