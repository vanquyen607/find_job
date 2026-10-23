const express = require('express');
const router = express.Router();
const {
  saveJobForUser,
  removeSavedJob,
  getSavedJobs,
  isJobSaved,
  getJobByUrl,
  saveJobs,
  saveSearchHistory,
  getSearchHistory
} = require('../database');
const { requireAuth } = require('../auth');
const { isAllowedJobUrl, sanitizeText, toPositiveInt } = require('../security');

// GET /api/saved-jobs - Get all saved jobs for user
router.get('/', requireAuth, (req, res) => {
  try {
    const jobs = getSavedJobs(req.user.id);
    res.json({ jobs, total: jobs.length });
  } catch (error) {
    console.error('[SAVED] Get error:', error.message);
    res.status(500).json({ error: 'Không thể lấy danh sách việc đã lưu' });
  }
});

// POST /api/saved-jobs - Save a job
router.post('/', requireAuth, (req, res) => {
  const jobUrl = sanitizeText(req.body?.jobUrl, 1000);
  const notes = sanitizeText(req.body?.notes, 500) || null;
  const jobData = req.body?.jobData;

  if (!jobUrl) {
    return res.status(400).json({ error: 'Thiếu đường dẫn việc làm' });
  }

  if (!isAllowedJobUrl(jobUrl)) {
    return res.status(400).json({ error: 'Đường dẫn việc làm không hợp lệ' });
  }

  try {
    let job = getJobByUrl(jobUrl);

    if (!job && jobData && typeof jobData === 'object') {
      saveJobs([{
        title: sanitizeText(jobData.title, 300),
        company: sanitizeText(jobData.company, 200),
        location: sanitizeText(jobData.location, 200),
        salary: sanitizeText(jobData.salary, 100),
        experience: sanitizeText(jobData.experience, 100),
        description: sanitizeText(jobData.description, 5000),
        requirements: sanitizeText(jobData.requirements, 5000),
        skills: sanitizeText(jobData.skills, 500),
        url: jobUrl,
        platform: sanitizeText(jobData.platform, 40)
      }]);
      job = getJobByUrl(jobUrl);
    }

    if (!job) {
      return res.status(400).json({ error: 'Không tìm thấy việc làm' });
    }

    const result = saveJobForUser(req.user.id, job.id, notes);
    if (!result) {
      return res.status(409).json({ error: 'Việc này đã được lưu' });
    }

    res.json({ message: 'Đã lưu việc làm', id: result.id, jobId: job.id });
  } catch (error) {
    console.error('[SAVED] Save error:', error.message);
    res.status(500).json({ error: 'Không thể lưu việc làm' });
  }
});

// DELETE /api/saved-jobs/:jobId - Remove saved job
router.delete('/:jobId', requireAuth, (req, res) => {
  const jobId = toPositiveInt(req.params.jobId);

  if (!jobId) {
    return res.status(400).json({ error: 'Job ID không hợp lệ' });
  }

  try {
    removeSavedJob(req.user.id, jobId);
    res.json({ message: 'Đã xóa khỏi danh sách lưu' });
  } catch (error) {
    console.error('[SAVED] Delete error:', error.message);
    res.status(500).json({ error: 'Không thể xóa' });
  }
});

// GET /api/saved-jobs/check/:jobId - Check if job is saved
router.get('/check/:jobId', requireAuth, (req, res) => {
  const jobId = toPositiveInt(req.params.jobId);
  if (!jobId) {
    return res.status(400).json({ error: 'Job ID không hợp lệ' });
  }
  res.json({ saved: isJobSaved(req.user.id, jobId) });
});

// GET /api/saved-jobs/history - Get search history
router.get('/history', requireAuth, (req, res) => {
  try {
    const history = getSearchHistory(req.user.id);
    res.json({ history });
  } catch (error) {
    console.error('[HISTORY] Get error:', error.message);
    res.status(500).json({ error: 'Không thể lấy lịch sử tìm kiếm' });
  }
});

// POST /api/saved-jobs/history - Save search
router.post('/history', requireAuth, (req, res) => {
  const keyword = sanitizeText(req.body?.keyword, 100);
  const resultsCount = Number(req.body?.resultsCount);

  if (!keyword) {
    return res.status(400).json({ error: 'Từ khóa là bắt buộc' });
  }

  try {
    saveSearchHistory(
      req.user.id,
      keyword,
      Number.isFinite(resultsCount) ? Math.max(0, Math.min(100000, Math.floor(resultsCount))) : 0
    );
    res.json({ message: 'Đã lưu lịch sử' });
  } catch (error) {
    console.error('[HISTORY] Save error:', error.message);
    res.status(500).json({ error: 'Không thể lưu lịch sử' });
  }
});

module.exports = router;
