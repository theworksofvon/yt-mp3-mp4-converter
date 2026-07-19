// API base URL - defaults to current origin
const API_BASE = window.location.origin;

// DOM elements
const form = document.getElementById('converterForm');
const urlInput = document.getElementById('url');
const submitBtn = document.getElementById('submitBtn');
const statusDiv = document.getElementById('status');

/**
 * Show status message
 * @param {string} message - The message to display
 * @param {string} type - The type of status: 'processing', 'success', or 'error'
 */
function showStatus(message, type = 'processing') {
  statusDiv.className = `status ${type}`;

  if (type === 'processing') {
    statusDiv.innerHTML = `<span class="spinner"></span>${message}`;
  } else if (type === 'success') {
    statusDiv.innerHTML = message;
  } else {
    statusDiv.textContent = message;
  }
}

/**
 * Clear status message
 */
function clearStatus() {
  statusDiv.className = 'status';
  statusDiv.textContent = '';
}

// Used when the server does not report a deadline. Matches the longest
// server-side budget (MP4), so an older server is never given up on early.
const FALLBACK_POLL_TIMEOUT_SECONDS = 960;
const MIN_POLL_INTERVAL = 1000;
const MAX_POLL_INTERVAL = 5000;

/**
 * Poll job status until completion
 * @param {string} jobId - The job ID to poll
 * @param {number} [timeoutSeconds] - Server-reported deadline for this format
 * @returns {Promise<Object>} - The completed job data
 */
async function pollJobStatus(jobId, timeoutSeconds) {
  const budget = Number(timeoutSeconds) > 0 ? Number(timeoutSeconds) : FALLBACK_POLL_TIMEOUT_SECONDS;
  const deadline = Date.now() + budget * 1000;
  let interval = MIN_POLL_INTERVAL;

  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error('Conversion timed out');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), remaining);
    let response;
    let data;

    try {
      response = await fetch(`${API_BASE}/api/jobs/${jobId}`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to check job status');
      }

      data = await response.json();
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Conversion timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (data.status === 'completed') {
      return data;
    }

    if (data.status === 'failed') {
      throw new Error(data.error || 'Conversion failed');
    }

    const waitRemaining = deadline - Date.now();
    if (waitRemaining <= 0) {
      throw new Error('Conversion timed out');
    }

    // Back off gradually so long conversions do not flood the server.
    await new Promise(resolve => setTimeout(resolve, Math.min(interval, waitRemaining)));
    interval = Math.min(interval * 1.5, MAX_POLL_INTERVAL);
  }
}

/**
 * Handle form submission
 */
async function handleSubmit(event) {
  event.preventDefault();

  const url = urlInput.value.trim();
  const format = document.querySelector('input[name="format"]:checked').value;

  // Reset UI
  clearStatus();
  submitBtn.disabled = true;

  try {
    const action = format === 'transcript' ? 'transcript download' : 'conversion';

    // Show processing status
    showStatus(`Starting ${action}...`, 'processing');

    // Start conversion
    const response = await fetch(`${API_BASE}/api/convert`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, format }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start conversion');
    }

    const { jobId, pollTimeoutSeconds } = await response.json();

    // Poll for completion
    showStatus(`${format === 'transcript' ? 'Preparing transcript' : `Converting ${format.toUpperCase()}`}... This may take a moment.`, 'processing');

    const job = await pollJobStatus(jobId, pollTimeoutSeconds);

    // Show success with download link
    const downloadUrl = `${API_BASE}/downloads/${jobId}`;
    const displayName = job.filename.length > 40
      ? job.filename.substring(0, 37) + '...' + job.filename.slice(-4)
      : job.filename;
    showStatus(
      `${format === 'transcript' ? 'Transcript ready!' : 'Conversion complete!'}<br><a href="${downloadUrl}" class="download-link" download="${job.filename}">Download ${job.format === 'transcript' ? 'Transcript' : job.format.toUpperCase()}</a><span class="filename" title="${job.filename}">${displayName}</span>`,
      'success'
    );

    // Trigger download automatically after a short delay
    setTimeout(() => {
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = job.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }, 500);

  } catch (error) {
    showStatus(error.message || 'An error occurred during conversion', 'error');
    console.error('Conversion error:', error);
  } finally {
    submitBtn.disabled = false;
  }
}

/**
 * Validate YouTube URL
 * @param {string} url - The URL to validate
 * @returns {boolean} - Whether the URL is valid
 */
function isValidYouTubeUrl(url) {
  const pattern = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]+/;
  return pattern.test(url);
}

/**
 * Handle input validation
 */
urlInput.addEventListener('input', () => {
  const url = urlInput.value.trim();
  if (url && !isValidYouTubeUrl(url)) {
    urlInput.style.borderColor = '#e94560';
  } else {
    urlInput.style.borderColor = '#e0e0e0';
  }
});

// Attach form submit handler
form.addEventListener('submit', handleSubmit);
