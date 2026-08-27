const express = require('express');
const router = express.Router();
const { 
  saveJobForUser, 
  removeSavedJob, 
  getSavedJobs, 
  isJobSaved,
  saveSearchHistory,
  getSearchHistory 
} = require('../database');
const { requireAuth } = require('../auth');

// GET /api/saved-jobs - Get all saved jobs for user
router.get('/', requireAuth, (req, res) => {
  try {
    const jobs = getSavedJobs(req.user.id);
    res.json({ jobs, total: jobs.length });
  } catch (error) {
    console.error('[SAVED] Get error:', error);
    res.status(500).json({ error: 'Không thể lấy danh sách việc đã lưu' });
  }
});

// POST /api/saved-jobs - Save a job
router.post('/', requireAuth, (req, res) => {
  const { jobUrl, jobData, notes } = req.body;
  
  if (!jobUrl && !jobData?.id) {
    return res.status(400).json({ error: 'Job URL hoặc Job ID là bắt buộc' });
  }
  
  try {
    // If we have jobData, save it to jobs table first
    if (jobData) {
      const { saveJobs } = require('../database');
      saveJobs([jobData]);
    }
    
    // Get job ID from URL if not provided
    let jobId = jobData?.id;
    if (!jobId && jobUrl) {
      const { getJobByUrl } = require('../database');
      const job = getJobByUrl(jobUrl);
      if (job) {
        jobId = job.id;
      }
    }
    
    if (!jobId) {
      return res.status(400).json({ error: 'Không tìm thấy việc làm' });
    }
    
    const result = saveJobForUser(req.user.id, jobId, notes);
    if (!result) {
      return res.status(409).json({ error: 'Việc này đã được lưu' });
    }
    res.json({ message: 'Đã lưu việc làm', id: result.id });
  } catch (error) {
    console.error('[SAVED] Save error:', error);
    res.status(500).json({ error: 'Không thể lưu việc làm' });
  }
});

// DELETE /api/saved-jobs/:jobId - Remove saved job
router.delete('/:jobId', requireAuth, (req, res) => {
  const jobId = parseInt(req.params.jobId);
  
  try {
    removeSavedJob(req.user.id, jobId);
    res.json({ message: 'Đã xóa khỏi danh sách lưu' });
  } catch (error) {
    console.error('[SAVED] Delete error:', error);
    res.status(500).json({ error: 'Không thể xóa' });
  }
});

// GET /api/saved-jobs/check/:jobId - Check if job is saved
router.get('/check/:jobId', requireAuth, (req, res) => {
  const jobId = parseInt(req.params.jobId);
  const saved = isJobSaved(req.user.id, jobId);
  res.json({ saved });
});

// GET /api/search-history - Get search history
router.get('/history', requireAuth, (req, res) => {
  try {
    const history = getSearchHistory(req.user.id);
    res.json({ history });
  } catch (error) {
    console.error('[HISTORY] Get error:', error);
    res.status(500).json({ error: 'Không thể lấy lịch sử tìm kiếm' });
  }
});

// POST /api/search-history - Save search
router.post('/history', requireAuth, (req, res) => {
  const { keyword, resultsCount } = req.body;
  
  if (!keyword) {
    return res.status(400).json({ error: 'Keyword là bắt buộc' });
  }
  
  try {
    saveSearchHistory(req.user.id, keyword, resultsCount || 0);
    res.json({ message: 'Đã lưu lịch sử' });
  } catch (error) {
    console.error('[HISTORY] Save error:', error);
    res.status(500).json({ error: 'Không thể lưu lịch sử' });
  }
});

module.exports = router;
