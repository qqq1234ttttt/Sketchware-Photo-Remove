
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3000;

const PIXEL_API_BASE = 'https://api.pixelapi.dev';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024,
        files: 2
    }
});

app.get('/', (req, res) => {
    res.status(200).send('Photo Remove API is running.');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.post(
    '/api/remove-object',
    upload.fields([
        { name: 'image', maxCount: 1 },
        { name: 'mask', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            const apiKey = process.env.PIXEL_API_KEY;

            if (!apiKey) {
                return res.status(500).json({
                    error: 'PIXEL_API_KEY is missing on Render.'
                });
            }

            if (
                !req.files ||
                !req.files.image ||
                !req.files.image[0]
            ) {
                return res.status(400).json({
                    error: 'Image file is required.'
                });
            }

            const image = req.files.image[0];
            const mask = req.files.mask && req.files.mask[0];

            if (!mask) {
                return res.status(400).json({
                    error: 'Mask file is required.'
                });
            }

            // Original image and mask must have matching dimensions.
            const form = new FormData();

            form.append('image', image.buffer, {
                filename: 'image.jpg',
                contentType: image.mimetype
            });

            form.append('mask', mask.buffer, {
                filename: 'mask.png',
                contentType: mask.mimetype
            });

            // Submit object-removal job to PixelAPI.
            const jobResponse = await axios.post(
                `${PIXEL_API_BASE}/v1/image/remove-object`,
                form,
                {
                    headers: {
                        ...form.getHeaders(),
                        Authorization: `Bearer ${apiKey}`,
                        'User-Agent': 'SketchwarePhotoRemove/1.0'
                    },
                    timeout: 30000,
                    maxBodyLength: Infinity,
                    maxContentLength: Infinity
                }
            );

            const generationId =
                jobResponse.data.generation_id ||
                jobResponse.data.id;

            if (!generationId) {
                return res.status(502).json({
                    error: 'PixelAPI did not return a job ID.',
                    details: JSON.stringify(jobResponse.data)
                });
            }

            // Poll job status until the result is ready.
            let outputUrl = null;
            const maxAttempts = 45;

            for (let i = 0; i < maxAttempts; i++) {
                await new Promise(resolve =>
                    setTimeout(resolve, 2000)
                );

                const statusResponse = await axios.get(
                    `${PIXEL_API_BASE}/v1/image/${encodeURIComponent(generationId)}`,
                    {
                        headers: {
                            Authorization: `Bearer ${apiKey}`,
                            'User-Agent': 'SketchwarePhotoRemove/1.0'
                        },
                        timeout: 20000
                    }
                );

                const job = statusResponse.data;
                const status = String(job.status || '').toLowerCase();

                if (status === 'completed') {
                    outputUrl = job.output_url;
                    break;
                }

                if (
                    status === 'failed' ||
                    status === 'blocked' ||
                    status === 'cancelled'
                ) {
                    return res.status(502).json({
                        error: 'PixelAPI image processing failed.',
                        details: JSON.stringify(job)
                    });
                }
            }

            if (!outputUrl) {
                return res.status(504).json({
                    error: 'Image processing timed out. Please try again.'
                });
            }

            // Download the finished image and return its bytes.
            const result = await axios.get(outputUrl, {
                responseType: 'arraybuffer',
                timeout: 30000,
                maxContentLength: 25 * 1024 * 1024
            });

            const contentType =
                result.headers['content-type'] || 'image/jpeg';

            if (!contentType.startsWith('image/')) {
                return res.status(502).json({
                    error: 'PixelAPI returned a non-image result.'
                });
            }

            res.set('Content-Type', contentType);
            res.set('Cache-Control', 'no-store');
            return res.status(200).send(Buffer.from(result.data));

        } catch (error) {
            const statusCode = error.response?.status || 500;

            let details = error.message;

            if (error.response?.data) {
                const data = error.response.data;

                if (Buffer.isBuffer(data)) {
                    details = data.toString('utf8').slice(0, 2000);
                } else if (typeof data === 'object') {
                    details = JSON.stringify(data).slice(0, 2000);
                } else {
                    details = String(data).slice(0, 2000);
                }
            }

            console.error('Remove-object error:', statusCode, details);

            if (!res.headersSent) {
                return res.status(500).json({
                    error: 'AI image processing failed.',
                    details: details
                });
            }
        }
    }
);

app.use((err, req, res, next) => {
    console.error('Request error:', err.message);

    if (res.headersSent) return next(err);

    const status = err instanceof multer.MulterError ? 400 : 500;

    res.status(status).json({
        error: err instanceof multer.MulterError
            ? 'Image upload failed or file is too large.'
            : 'Internal server error.'
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
