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

/**
 * Poll job status until completion
 * @param {string} jobId - The job ID to poll
 * @returns {Promise<Object>} - The completed job data
 */
async function pollJobStatus(jobId) {
  const maxAttempts = 120; // 2 minutes with 1-second intervals
  const interval = 1000;

  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(`${API_BASE}/api/jobs/${jobId}`);

    if (!response.ok) {
      throw new Error('Failed to check job status');
    }

    const data = await response.json();

    if (data.status === 'completed') {
      return data;
    }

    if (data.status === 'failed') {
      throw new Error(data.error || 'Conversion failed');
    }

    // Still processing, wait and retry
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error('Conversion timed out');
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
    // Show processing status
    showStatus('Starting conversion...', 'processing');

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

    const { jobId } = await response.json();

    // Poll for completion
    showStatus(`Converting ${format.toUpperCase()}... This may take a moment.`, 'processing');

    const job = await pollJobStatus(jobId);

    // Show success with download link
    const downloadUrl = `${API_BASE}/downloads/${jobId}`;
    const displayName = job.filename.length > 40
      ? job.filename.substring(0, 37) + '...' + job.filename.slice(-4)
      : job.filename;
    showStatus(
      `Conversion complete!<br><a href="${downloadUrl}" class="download-link" download="${job.filename}">Download ${job.format.toUpperCase()}</a><span class="filename" title="${job.filename}">${displayName}</span>`,
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
