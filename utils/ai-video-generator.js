const OpenAI = require('openai');
const Replicate = require('replicate');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const sharp = require('sharp');
const { spawn } = require('child_process');
const { Logger } = require('./logger');
const { runFFmpeg, getMediaDuration, checkFFmpeg, ffmpegInstallHint } = require('./ffmpeg');
const { MediaGenerationService } = require('./media-generation-service');

class AIVideoGenerator {
  constructor(credentials, options = {}) {
    this.logger = new Logger('AIVideoGenerator');
    const resolvedCredentials = credentials?.credentials || credentials || {};
    this.db = options.db || null;
    this.getMediaDuration = options.getMediaDuration || getMediaDuration;
    this.lastVideoResult = null;
    this.lastNarrationResult = null;
    
    // Initialize AI services with graceful fallback
    const openaiKey = resolvedCredentials.openai?.apiKey || process.env.OPENAI_API_KEY;
    const replicateKey = resolvedCredentials.replicate?.apiKey || process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_API_KEY;
    
    if (openaiKey) {
      this.openai = new OpenAI({ apiKey: openaiKey });
      this.logger.info('OpenAI service initialized');
    } else {
      this.logger.warn('OpenAI API key not found - AI features will be simulated');
    }
    
    if (replicateKey) {
      this.replicate = new Replicate({ auth: replicateKey });
      this.logger.info('Replicate service initialized');
    } else {
      this.logger.warn('Replicate API key not found - advanced video generation unavailable');
    }

    // Gemini media generation (images + native TTS) — free-tier alternative to OpenAI
    const geminiKey = resolvedCredentials.gemini?.apiKey || process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const { GoogleGenAI } = require('@google/genai');
        this.gemini = new GoogleGenAI({ apiKey: geminiKey });
        this.logger.info('Gemini media service initialized (images + TTS)');
      } catch (error) {
        this.logger.warn('Failed to initialize Gemini media service:', error.message);
      }
    }
    
    // ElevenLabs configuration
    this.elevenLabsApiKey = resolvedCredentials.elevenLabs?.apiKey || process.env.ELEVENLABS_API_KEY;
    this.elevenLabsVoiceId = resolvedCredentials.elevenLabs?.voiceId || process.env.ELEVENLABS_VOICE_ID;
    this.elevenLabsModel = process.env.ELEVENLABS_TTS_MODEL || 'eleven_v3';
    
    // Azure Speech configuration
    this.azureSpeechKey = resolvedCredentials.azure?.speechKey || process.env.AZURE_SPEECH_KEY;
    this.azureSpeechRegion = resolvedCredentials.azure?.speechRegion || process.env.AZURE_SPEECH_REGION;

    // Edge-TTS (Microsoft neural voices via local edge-tts CLI) — free local narration
    this.edgeTtsBin = this._resolveEdgeTtsBin();
    this.edgeTtsVoice = process.env.EDGE_TTS_VOICE || 'pt-BR-FranciscaNeural';
    this.edgeTtsRate = process.env.EDGE_TTS_RATE || '';
    this.edgeTtsPitch = process.env.EDGE_TTS_PITCH || '';
    if (this.edgeTtsBin) {
      this.logger.info(`Edge-TTS initialized (voice: ${this.edgeTtsVoice})`);
    }
    this.mediaGeneration = options.mediaGeneration || (this.db
      ? new MediaGenerationService(this.db, resolvedCredentials, { logger: this.logger })
      : null);
  }

  async generateTTSAudio(text, outputPath) {
    this.logger.info('Generating TTS audio...');
    this.lastNarrationResult = null;
    let provider = 'simulation';
    let model = null;

    try {
      let generatedPath;
      if (this.edgeTtsBin) {
        provider = 'edge-tts';
        model = this.edgeTtsVoice;
        generatedPath = await this.generateEdgeTTS(text, outputPath);
      } else if (this.elevenLabsApiKey && this.elevenLabsVoiceId) {
        provider = 'elevenlabs';
        model = this.elevenLabsModel;
        generatedPath = await this.generateElevenLabsTTS(text, outputPath);
      } else if (this.openai) {
        provider = 'openai';
        model = 'gpt-4o-mini-tts';
        generatedPath = await this.generateOpenAITTS(text, outputPath);
      } else if (this.gemini) {
        provider = 'gemini';
        model = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
        generatedPath = await this.generateGeminiTTS(text, outputPath);
      } else {
        generatedPath = await this.simulateTTSGeneration(text, outputPath);
      }

      const usable = await this.isUsableAudioFile(generatedPath);
      this.lastNarrationResult = {
        status: usable ? 'ready' : 'unavailable',
        path: generatedPath,
        provider,
        model,
        externalTaskId: null,
        generatedAt: new Date().toISOString(),
        simulated: !usable,
        cost: { provider, amount: null, currency: null, invoiceRequired: provider !== 'simulation' }
      };
      return generatedPath;
    } catch (error) {
      this.lastNarrationResult = {
        status: 'failed', path: null, provider, model, externalTaskId: null,
        generatedAt: new Date().toISOString(), simulated: false, error: error.message,
        cost: { provider, amount: null, currency: null, invoiceRequired: provider !== 'simulation' }
      };
      this.logger.error('TTS generation failed:', error);
      throw error;
    }
  }

  _resolveEdgeTtsBin() {
    const os = require('os');
    const fsSync = require('fs');
    const candidates = [
      process.env.EDGE_TTS_PATH,
      path.join(os.homedir(), '.local', 'bin', 'edge-tts'),
    ].filter(Boolean);
    for (const candidate of candidates) {
      try {
        if (fsSync.existsSync(candidate)) return candidate;
      } catch (_error) { /* try the next candidate */ }
    }
    try {
      const probe = require('child_process').spawnSync('edge-tts', ['--help'], { timeout: 15000 });
      if (!probe.error && probe.status === 0) return 'edge-tts';
    } catch (_error) { /* not on PATH */ }
    return null;
  }

  async generateEdgeTTS(text, outputPath) {
    const textPath = `${outputPath}.txt`;
    await fs.writeFile(textPath, text, 'utf8');
    const args = ['--voice', this.edgeTtsVoice, '--file', textPath, '--write-media', outputPath];
    if (this.edgeTtsRate) args.push('--rate', this.edgeTtsRate);
    if (this.edgeTtsPitch) args.push('--pitch', this.edgeTtsPitch);
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(this.edgeTtsBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        child.stdout.resume();
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', code => {
          if (code === 0) resolve();
          else reject(new Error(`edge-tts exited with code ${code}: ${stderr.slice(0, 300)}`));
        });
      });
    } finally {
      await fs.unlink(textPath).catch(() => {});
    }
    this.logger.info('Edge-TTS generation complete');
    return outputPath;
  }

  async generateElevenLabsTTS(text, outputPath) {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.elevenLabsVoiceId}`;
    
    const data = {
      text: text,
      model_id: this.elevenLabsModel,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8,
        style: 0.0,
        use_speaker_boost: true
      }
    };

    const response = await axios({
      method: 'POST',
      url: url,
      data: data,
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': this.elevenLabsApiKey
      },
      responseType: 'stream'
    });

    const writer = require('fs').createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        this.logger.info('ElevenLabs TTS generation complete');
        resolve(outputPath);
      });
      writer.on('error', reject);
    });
  }

  async generateOpenAITTS(text, outputPath) {
    const response = await this.openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "coral",
      input: text,
      speed: 1.0
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(outputPath, buffer);

    this.logger.info('OpenAI TTS generation complete');
    return outputPath;
  }

  async generateGeminiTTS(text, outputPath) {
    const model = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
    const voiceName = process.env.GEMINI_TTS_VOICE || 'Kore';

    const response = await this.gemini.models.generateContent({
      model,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName }
          }
        }
      }
    });

    const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioData) {
      throw new Error('Gemini TTS returned no audio data');
    }

    // Gemini returns raw PCM (24kHz, mono, 16-bit); encode to the requested container via FFmpeg
    const pcmPath = outputPath + '.pcm';
    await fs.writeFile(pcmPath, Buffer.from(audioData, 'base64'));
    await runFFmpeg(['-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcmPath, outputPath]);
    await fs.unlink(pcmPath).catch(() => {});

    this.logger.info('Gemini TTS generation complete');
    return outputPath;
  }

  async generateVisualAssets(prompt, style = "ethereal", count = 1) {
    this.logger.info(`Generating ${count} visual assets with style: ${style}`);

    try {
      if (!this.openai && !this.gemini) {
        return await this.simulateVisualAssets(prompt, style, count);
      }

      const enhancedPrompt = this.enhanceVisualPrompt(prompt, style);
      const localPaths = [];

      for (let i = 0; i < count; i++) {
        const imagePath = path.join(__dirname, '..', 'data', 'assets', `visual_${Date.now()}_${i}.png`);
        await this.generateImage(enhancedPrompt, imagePath);
        localPaths.push(imagePath);
      }

      this.logger.info(`Generated ${localPaths.length} visual assets`);
      return localPaths;
    } catch (error) {
      this.logger.error('Visual asset generation failed:', error);
      return await this.simulateVisualAssets(prompt, style, count);
    }
  }

  async _geminiWebAvailable() {
    if (process.env.GEMINI_WEB === '0') return false;
    if (!this.geminiWeb) {
      const { GeminiWebImageGenerator } = require('./gemini-web-image');
      this.geminiWeb = new GeminiWebImageGenerator({ logger: this.logger });
    }
    return this.geminiWeb.isAvailable();
  }

  async generateImage(prompt, imagePath) {
    await fs.mkdir(path.dirname(imagePath), { recursive: true });

    if (this.openai) {
      return await this.generateOpenAIImage(prompt, imagePath);
    }

    if (this.gemini && !this._geminiImageQuotaExceeded) {
      try {
        return await this.generateGeminiImage(prompt, imagePath);
      } catch (error) {
        if (/quota|429|rate.?limit|RESOURCE_EXHAUSTED/i.test(error.message || String(error))) {
          this._geminiImageQuotaExceeded = true;
          this.logger.warn('Gemini API image quota exhausted — using the Gemini web provider for the rest of this run');
        } else {
          throw error;
        }
      }
    }

    if (process.env.GEMINI_WEB !== '0' && await this._geminiWebAvailable()) {
      try {
        return await this.geminiWeb.generateImage(prompt, imagePath);
      } catch (error) {
        this.logger.warn(`Gemini web image failed: ${error.message} — using a stock photo for this shot`);
        if (/has been closed|Target closed/i.test(error.message || String(error))) {
          // The browser crashed (OOM etc.) — drop it so the next shot relaunches fresh.
          await this.geminiWeb.close().catch(() => {});
          this.geminiWeb = null;
        }
      }
    }

    // Last resort that still keeps every shot unique: free stock photo matched
    // to the scene keywords (no account/quota needed).
    return await this.generateStockImage(prompt, imagePath);
  }

  // Free stock photo fallback, no account/quota needed. Tries keyword-matched
  // LoremFlickr (CC images) first, then a random Picsum photo — every shot
  // still gets a unique real image.
  async generateStockImage(prompt, imagePath) {
    const stop = new Set(['the', 'a', 'an', 'de', 'do', 'da', 'and', 'with', 'in', 'on', 'at', 'of', 'to', 'um', 'uma', 'o', 'as', 'no', 'na']);
    const keywords = String(prompt || 'cinematic scene')
      .toLowerCase().replace(/[^a-zà-ÿ\s]/g, ' ').split(/\s+/)
      .filter(word => word.length > 3 && !stop.has(word)).slice(0, 3).join(',');
    let hash = 0;
    for (const ch of String(prompt)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;

    const sources = [
      `https://loremflickr.com/1920/1080/${encodeURIComponent(keywords || 'nature,landscape')}?lock=${hash % 100000}`,
      `https://picsum.photos/seed/${hash % 100000}/1920/1080`
    ];
    const headers = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36' };

    for (const url of sources) {
      try {
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxRedirects: 5, headers });
        const buffer = Buffer.from(response.data);
        const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
        if (!metadata.width || !metadata.height) continue;
        await sharp(buffer).png().toFile(imagePath);
        return imagePath;
      } catch (error) {
        this.logger.warn(`Stock image source failed (${url.split('/')[2]}): ${error.message}`);
      }
    }
    throw new Error('No stock image source responded');
  }

  async generateOpenAIImage(prompt, imagePath) {
    const response = await this.openai.images.generate({
      model: "gpt-image-2",
      prompt: prompt,
      n: 1,
      size: "1536x1024",
      quality: "high",
    });

    if (response.data[0].b64_json) {
      const buffer = Buffer.from(response.data[0].b64_json, 'base64');
      await fs.writeFile(imagePath, buffer);
    } else {
      await this.downloadImage(response.data[0].url, imagePath);
    }

    return imagePath;
  }

  async generateGeminiImage(prompt, imagePath) {
    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';

    const response = await this.gemini.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: '16:9',
          imageSize: '1K'
        }
      }
    });

    const parts = response.candidates?.[0]?.content?.parts || [];
    const imageParts = parts.filter(part =>
      part.inlineData?.data && (!part.inlineData.mimeType || part.inlineData.mimeType.startsWith('image/'))
    );
    const renderedImages = imageParts.filter(part => part.thought !== true);
    const imagePart = (renderedImages.length ? renderedImages : imageParts).at(-1);
    if (!imagePart) {
      throw new Error('Gemini image generation returned no image data');
    }

    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
    const metadata = await sharp(imageBuffer, { failOn: 'error' }).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error('Gemini image generation returned an invalid image asset');
    }

    const extension = path.extname(imagePath).toLowerCase();
    const output = sharp(imageBuffer, { failOn: 'error' });
    if (extension === '.jpg' || extension === '.jpeg') {
      await output.jpeg({ quality: 92 }).toFile(imagePath);
    } else if (extension === '.webp') {
      await output.webp({ quality: 92 }).toFile(imagePath);
    } else {
      await output.png().toFile(imagePath);
    }
    return imagePath;
  }

  enhanceVisualPrompt(prompt, style) {
    const styleEnhancements = {
      ethereal: "ethereal, dreamy, mystical, soft lighting, floating particles, cosmic background",
      modern: "modern, clean, minimalist, professional, sleek design, contemporary",
      animated: "animated style, cartoon, vibrant colors, expressive, dynamic",
      cinematic: "cinematic lighting, dramatic, movie poster style, high contrast",
      abstract: "abstract art, geometric shapes, gradient colors, artistic composition"
    };

    const normalizedStyle = String(style || '').trim().toLowerCase();
    const enhancement = styleEnhancements[normalizedStyle] || String(style || '').trim() || styleEnhancements.ethereal;
    return `${prompt}, ${enhancement}, high quality, 16:9 aspect ratio, digital art`;
  }

  async downloadImage(url, outputPath) {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const writer = require('fs').createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  async generateVideo(script, visualAssets, audioPath, outputPath, options = {}) {
    this.logger.info('Generating video from assets...');
    this.lastVideoResult = null;
    try {
      if (this.mediaGeneration && options.productionId) {
        const generated = await this.mediaGeneration.generateClips({
          jobId: options.jobId || null,
          productionId: options.productionId,
          script,
          visualAssets,
          outputDir: path.dirname(outputPath)
        });
        if (generated.clips.length) {
          const produced = await this.generateHybridVideo(
            generated.clips,
            visualAssets,
            audioPath,
            outputPath,
            options.estimatedDuration || this.calculateScriptDuration(script)
          );
          this.lastVideoResult = {
            requestedProvider: generated.requestedProvider,
            actualProvider: generated.actualProvider,
            model: generated.model,
            mode: generated.settings.mode,
            generatedSeconds: generated.clips.reduce((total, clip) => total + clip.duration, 0),
            tasks: generated.clips.map(clip => ({ scene: clip.index, taskId: clip.taskId, provider: clip.provider, model: clip.model })),
            scenes: generated.clips.map(clip => ({
              index: clip.index, label: clip.label, prompt: clip.prompt, duration: clip.duration,
              path: clip.path, taskId: clip.taskId, provider: clip.provider, model: clip.model
            }))
          };
          return produced;
        }
      }

      const produced = await this.generateSlideshowVideo(script, visualAssets, audioPath, outputPath);
      this.lastVideoResult = { requestedProvider: 'slideshow', actualProvider: 'slideshow', model: 'local-ffmpeg', mode: 'slideshow', generatedSeconds: 0, tasks: [], scenes: [] };
      return produced;
    } catch (error) {
      // The Logger's console line only shows the message string, so put the real
      // reason inline. Previously the stack alone went to the file transport and
      // the console printed "Video generation failed:" with no detail.
      const reason = error && error.message ? error.message : String(error);
      this.logger.error(`Video provider generation failed; using the local slideshow: ${reason}`, error);
      try {
        const produced = await this.generateSlideshowVideo(script, visualAssets, audioPath, outputPath);
        this.lastVideoResult = {
          requestedProvider: this.lastVideoResult?.requestedProvider || 'configured-provider',
          actualProvider: 'slideshow', model: 'local-ffmpeg', mode: 'fallback', generatedSeconds: 0,
          fallbackReason: reason, tasks: [], scenes: []
        };
        return produced;
      } catch (fallbackError) {
        this.logger.error(`Local slideshow fallback failed: ${fallbackError.message}`, fallbackError);
        const produced = await this.simulateVideoGeneration(script, visualAssets, audioPath, outputPath);
        this.lastVideoResult = {
          requestedProvider: 'configured-provider', actualProvider: 'simulation', model: null,
          mode: 'simulation', generatedSeconds: 0, fallbackReason: `${reason}; ${fallbackError.message}`, tasks: [], scenes: []
        };
        return produced;
      }
    }
  }

  async generateHybridVideo(clips, visualAssets, audioPath, outputPath, totalDuration) {
    if (!(await checkFFmpeg())) throw new Error(ffmpegInstallHint());
    const validImages = await this.filterLocalImageAssets(visualAssets);
    const segments = clips.map(clip => ({ type: 'video', path: clip.path, duration: clip.duration }));
    const generatedDuration = segments.reduce((sum, item) => sum + item.duration, 0);
    const remaining = Math.max(0, this.parseDurationSeconds(totalDuration) - generatedDuration);
    if (remaining && validImages.length) {
      const perImage = Math.max(2, remaining / validImages.length);
      for (const imagePath of validImages) segments.push({ type: 'image', path: imagePath, duration: perImage });
    }
    if (!segments.length) throw new Error('No usable provider clips or still images were generated');

    const visualPath = outputPath.replace(/\.mp4$/i, '_hybrid_visual.mp4');
    await this.renderMediaTimeline(segments, visualPath);
    await this.addAudioToVideo(visualPath, audioPath, outputPath, { loopVideo: true });
    await fs.unlink(visualPath).catch(() => {});
    return outputPath;
  }

  async renderMediaTimeline(segments, outputPath) {
    const args = ['-y'];
    for (const segment of segments) {
      if (segment.type === 'image') args.push('-loop', '1', '-t', Number(segment.duration).toFixed(2), '-framerate', '30', '-i', segment.path);
      else args.push('-stream_loop', '-1', '-i', segment.path);
    }
    const filters = segments.map((segment, index) =>
      `[${index}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p,trim=duration=${Number(segment.duration).toFixed(2)},setpts=PTS-STARTPTS[v${index}]`
    );
    filters.push(`${segments.map((_, index) => `[v${index}]`).join('')}concat=n=${segments.length}:v=1:a=0[vout]`);
    args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', outputPath);
    await runFFmpeg(args);
    return outputPath;
  }

  async filterLocalImageAssets(visualAssets = []) {
    const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
    const images = [];
    for (const asset of visualAssets) {
      if (typeof asset !== 'string' || !imageExtensions.has(path.extname(asset).toLowerCase())) continue;
      try {
        await fs.access(asset);
        images.push(asset);
      } catch (_error) { /* ignore missing assets */ }
    }
    return images;
  }

  parseDurationSeconds(value) {
    if (Number.isFinite(Number(value))) return Math.max(0, Number(value));
    const parts = String(value || '').split(':').map(Number);
    if (parts.length === 2 && parts.every(Number.isFinite)) return Math.max(0, parts[0] * 60 + parts[1]);
    if (parts.length === 3 && parts.every(Number.isFinite)) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
    return 0;
  }

  async generateReplicateVideo(script, visualAssets, audioPath, outputPath) {
    const output = await this.replicate.run(
      "wan-video/wan-2.7-i2v",
      {
        input: {
          image: visualAssets[0],
          prompt: script.title || "smooth cinematic motion",
          duration: 5,
          resolution: "720p"
        }
      }
    );

    // Download the generated video
    if (output && output.length > 0) {
      await this.downloadVideo(output[0], outputPath);
      
      // Add audio track
      await this.addAudioToVideo(outputPath, audioPath, outputPath);
    }

    return outputPath;
  }

  async generateSlideshowVideo(script, visualAssets, audioPath, outputPath) {
    this.logger.info('Creating slideshow video...');

    if (!(await checkFFmpeg())) {
      throw new Error(ffmpegInstallHint());
    }

    const settings = await this.resolveSlideshowSettings();
    if (settings.style === 'animated') {
      try {
        const { AnimatedSceneRenderer } = require('./animated-scene-renderer');
        const renderer = new AnimatedSceneRenderer({ logger: this.logger });
        return await renderer.render({ script, audioPath, outputPath });
      } catch (error) {
        this.logger.error(`Animated scene render failed; falling back to dynamic: ${error.message}`);
      }
    }
    if (settings.style === 'dynamic') {
      try {
        const produced = await this.generateDynamicSlideshow(script, visualAssets, audioPath, outputPath, settings.secondsPerImage);
        if (produced) return produced;
        // No AI image provider: still render the classic slides, but with
        // gentle Ken Burns motion so the video is not a static deck.
        this.logger.info('No AI image provider — applying gentle motion to the text slides');
        return await this.generateGentleMotionSlides(script, visualAssets, audioPath, outputPath);
      } catch (error) {
        this.logger.error(`Dynamic slideshow failed; using classic slides: ${error.message}`);
      }
    }

    const slidesDir = path.join(path.dirname(outputPath), 'slides');

    try {
      // Create HTML for slideshow (only real image files can be embedded)
      const imageAssets = await this.filterImageAssets(visualAssets);
      const stills = await this.captureSlideStills(script, imageAssets, slidesDir);

      const videoPath = outputPath.replace('.mp4', '_visual.mp4');
      const duration = await this.narrationDuration(script, audioPath);
      await this.renderSlidesToVideo(stills, duration, videoPath);

      // Add audio
      await this.addAudioToVideo(videoPath, audioPath, outputPath);

      return outputPath;
    } finally {
      await this.cleanupDirectory(slidesDir);
    }
  }

  async narrationDuration(script, audioPath) {
    let duration = this.calculateScriptDuration(script);
    try {
      // Prefer the real narration length so visuals cover the whole audio
      // (script word-count estimates diverge from edge-tts output).
      const audioDuration = await getMediaDuration(audioPath);
      if (Number.isFinite(audioDuration) && audioDuration > 0) duration = Math.ceil(audioDuration);
    } catch (_error) { /* keep the estimate */ }
    return duration;
  }

  async captureSlideStills(script, imageAssets, slidesDir) {
    const { chromium } = require('playwright');
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1920, height: 1080 });

      await page.setContent(this.createSlideshowHTML(script, imageAssets));

      // Freeze CSS transitions/animations so each still is captured fully rendered
      await page.addStyleTag({ content: '* { transition: none !important; animation: none !important; }' });
      await page.waitForTimeout(1000); // Wait for assets to load

      // Capture ONE still per slide instead of screenshotting at 30fps —
      // FFmpeg turns the stills into a video in seconds.
      const slideCount = await page.evaluate(() => document.querySelectorAll('.slide').length);
      await fs.mkdir(slidesDir, { recursive: true });

      const stills = [];
      for (let i = 0; i < slideCount; i++) {
        await page.evaluate((index) => {
          document.querySelectorAll('.slide').forEach((slide, s) => {
            slide.classList.toggle('active', s === index);
          });
        }, i);

        const stillPath = path.join(slidesDir, `slide_${String(i).padStart(3, '0')}.png`);
        await page.screenshot({ path: stillPath });
        stills.push(stillPath);
      }
      return stills;
    } finally {
      await browser.close().catch(() => {});
    }
  }

  // Classic text slides, sequenced with a subtle slow zoom instead of static
  // crossfades — used when no AI image provider key is configured.
  async generateGentleMotionSlides(script, visualAssets, audioPath, outputPath) {
    const slidesDir = path.join(path.dirname(outputPath), 'slides');
    try {
      const imageAssets = await this.filterImageAssets(visualAssets);
      const stills = await this.captureSlideStills(script, imageAssets, slidesDir);
      const duration = await this.narrationDuration(script, audioPath);
      const shots = stills.map(still => ({ path: still, duration: duration / stills.length }));

      const videoPath = outputPath.replace('.mp4', '_visual.mp4');
      await this.renderDynamicSequence(shots, videoPath, duration, { gentle: true });
      await this.addAudioToVideo(videoPath, audioPath, outputPath);
      await fs.unlink(videoPath).catch(() => {});
      return outputPath;
    } finally {
      await this.cleanupDirectory(slidesDir);
    }
  }

  async resolveSlideshowDuration(script, audioPath) {
    try {
      return (await this.getMediaDuration(audioPath)) + 0.5;
    } catch (error) {
      this.logger.warn(`Could not read narration duration, falling back to word-count estimate: ${error.message}`);
      return this.calculateScriptDuration(script);
    }
  }

  async renderSlidesToVideo(stills, totalDuration, videoPath) {
    if (stills.length === 0) {
      throw new Error('No slides to render');
    }

    const fade = 0.5;
    // Crossfades shorten the chain by (n-1)*fade; pad each slide so the final
    // video still reaches totalDuration (otherwise -shortest truncates narration).
    const overlapDuration = fade * Math.max(0, stills.length - 1);
    const perSlide = Math.max(2, (totalDuration + overlapDuration) / stills.length);

    const args = ['-y'];
    for (const still of stills) {
      args.push('-loop', '1', '-t', perSlide.toFixed(2), '-framerate', '30', '-i', still);
    }

    if (stills.length === 1) {
      args.push('-vf', 'format=yuv420p', '-c:v', 'libx264', videoPath);
      await runFFmpeg(args);
      return videoPath;
    }

    // Chain crossfades: transition k starts fade seconds before slide k ends
    const filters = [];
    let prev = '[0:v]';
    for (let i = 1; i < stills.length; i++) {
      const out = `[v${i}]`;
      const offset = (i * (perSlide - fade)).toFixed(2);
      filters.push(`${prev}[${i}:v]xfade=transition=fade:duration=${fade}:offset=${offset}${out}`);
      prev = out;
    }
    filters.push(`${prev}format=yuv420p[vfinal]`);

    args.push(
      '-filter_complex', filters.join(';'),
      '-map', '[vfinal]',
      '-c:v', 'libx264',
      '-r', '30',
      videoPath
    );

    await runFFmpeg(args);
    return videoPath;
  }

  async resolveSlideshowSettings() {
    const stored = this.db?.getAllSettings ? await this.db.getAllSettings() : {};
    const style = String(process.env.SLIDESHOW_STYLE || stored.slideshow_style || 'dynamic').toLowerCase();
    const secondsPerImage = Math.max(1, Number(process.env.SLIDESHOW_SECONDS_PER_IMAGE || stored.slideshow_seconds_per_image || 3.5));
    const normalized = ['classic', 'animated'].includes(style) ? style : 'dynamic';
    return { style: normalized, secondsPerImage };
  }

  // Split the script into timed shots: every scene becomes one or more images
  // (a new picture every `secondsPerImage` seconds), each with a slightly
  // different camera angle so the sequence reads as motion instead of slides.
  buildDynamicShotPlan(script = {}, totalDuration, secondsPerImage = 3.5) {
    const variants = [
      'wide establishing shot',
      'medium shot, slightly different camera angle',
      'close-up detail shot',
      'overhead top-down view',
      'low angle shot',
      'lateral dolly shot perspective',
      'shallow depth of field detail',
      'dramatic rim lighting shot'
    ];

    const scenes = [];
    const sceneText = section => typeof section.content === 'string'
      ? section.content
      : (section.items || section.steps || []).map(item => `${item.title || ''} ${item.description || ''}`).join(' ');

    if (script.hook?.text || script.title) {
      scenes.push({ label: 'Hook', text: script.hook?.text || script.title, prompt: `${script.hook?.text || script.title}. Cinematic opening shot, clear subject, no text, no captions.` });
    }
    for (const section of script.mainContent?.sections || []) {
      scenes.push({ label: section.title || 'Scene', text: `${section.title || ''} ${sceneText(section)}`, prompt: `${section.title || ''}. ${sceneText(section)}. Cinematic explanatory shot, no text, no captions.`.trim() });
    }
    if (script.conclusion?.finalThought) {
      scenes.push({ label: 'Conclusion', text: script.conclusion.finalThought, prompt: `${script.conclusion.finalThought}. Memorable cinematic closing shot, no text, no captions.` });
    }
    if (!scenes.length) scenes.push({ label: 'Scene', text: script.title || 'story', prompt: `${script.title || 'story'}. Cinematic shot, no text, no captions.` });

    const weights = scenes.map(scene => Math.max(8, scene.text.split(/\s+/).filter(Boolean).length));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    const shots = [];
    scenes.forEach((scene) => {
      const sceneDuration = Math.max(2, totalDuration * (weights[scenes.indexOf(scene)] / totalWeight));
      const shotCount = Math.max(1, Math.round(sceneDuration / secondsPerImage));
      const shotDuration = sceneDuration / shotCount;
      for (let i = 0; i < shotCount; i++) {
        const variant = variants[shots.length % variants.length];
        shots.push({ label: scene.label, prompt: `${scene.prompt} ${variant}.`, duration: shotDuration });
      }
    });
    return shots;
  }

  async generateDynamicSlideshow(script, visualAssets, audioPath, outputPath, secondsPerImage) {
    // Every shot always gets an image: OpenAI → Gemini API → Gemini web
    // (logged-in browser profile) → free stock photo. Whatever the source, the
    // result is a unique frame per shot instead of static text slides.
    const totalDuration = await this.narrationDuration(script, audioPath);

    const shots = this.buildDynamicShotPlan(script, totalDuration, secondsPerImage);
    const fallbackImages = await this.filterLocalImageAssets(visualAssets);
    const slidesDir = path.join(path.dirname(outputPath), `dyn_shots_${Date.now()}`);

    this.logger.info(`Dynamic slideshow: generating ${shots.length} images (~${secondsPerImage}s per image, ${totalDuration}s total)...`);

    try {
      await fs.mkdir(slidesDir, { recursive: true });
      const rendered = [];
      let lastImage = fallbackImages[0] || null;
      let consecutiveFailures = 0;
      for (const shot of shots) {
        let imagePath = null;
        if (consecutiveFailures < 2) {
          try {
            imagePath = path.join(slidesDir, `shot_${String(rendered.length).padStart(3, '0')}.png`);
            await this.generateImage(this.enhanceVisualPrompt(shot.prompt, 'cinematic'), imagePath);
            consecutiveFailures = 0;
            // Stay friendly with image provider rate limits
            await new Promise(resolve => setTimeout(resolve, 350));
          } catch (error) {
            consecutiveFailures += 1;
            this.logger.warn(`Shot image generation failed (${shot.label}): ${error.message}`);
            if (consecutiveFailures >= 2 && this.geminiWeb) await this.geminiWeb.close();
            imagePath = fallbackImages[rendered.length % Math.max(1, fallbackImages.length)] || lastImage;
          }
        } else {
          imagePath = fallbackImages[rendered.length % Math.max(1, fallbackImages.length)] || lastImage;
        }
        if (!imagePath) continue;
        if (await fs.access(imagePath).then(() => true).catch(() => false)) {
          lastImage = imagePath;
          rendered.push({ ...shot, path: imagePath });
        }
      }

      if (!rendered.length) {
        this.logger.warn('No AI images could be generated for the dynamic slideshow');
        return null;
      }

      const videoPath = outputPath.replace('.mp4', '_visual.mp4');
      await this.renderDynamicSequence(rendered, videoPath, totalDuration);
      await this.addAudioToVideo(videoPath, audioPath, outputPath);
      await fs.unlink(videoPath).catch(() => {});
      return outputPath;
    } finally {
      await this.cleanupDirectory(slidesDir);
    }
  }

  // Turn one image per shot into a moving video: Ken Burns zoom/pan per image
  // (alternate directions) chained with short xfade transitions.
  // options.gentle: subtle central zoom only + soft fades — safe for slides
  // that contain text, where pans and strong zooms could crop the content.
  async renderDynamicSequence(shots, videoPath, totalDuration = null, options = {}) {
    if (!shots.length) throw new Error('No images to render');

    const gentle = options.gentle === true;
    const fps = 30;
    const minDuration = Math.min(...shots.map(shot => shot.duration));
    const fade = Math.min(0.5, Math.max(0.2, minDuration / 2.2));

    // Crossfades shorten the final video by (n-1)*fade — pad the shots evenly
    // so the assembled video still covers the whole narration.
    let padded = shots.map(shot => ({ ...shot }));
    const target = Number(totalDuration) > 0 ? Number(totalDuration) : padded.reduce((sum, shot) => sum + shot.duration, 0);
    const deficit = target - (padded.reduce((sum, shot) => sum + shot.duration, 0) - fade * (padded.length - 1));
    if (deficit > 0) padded = padded.map(shot => ({ ...shot, duration: shot.duration + deficit / padded.length }));

    const motions = gentle
      ? [
        `zoompan=z='min(1+0.0007*on,1.09)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
        `zoompan=z='if(eq(on,0),1.09,max(1.09-0.0007*on,1))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`
      ]
      : [
        `zoompan=z='min(1+0.0011*on,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
        `zoompan=z='if(eq(on,0),1.3,max(1.3-0.0011*on,1))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`,
        `zoompan=z='1.22':x='(iw-iw/zoom)*on/{F}':y='(ih-ih/zoom)/2'`,
        `zoompan=z='1.22':x='(iw-iw/zoom)*(1-on/{F})':y='(ih-ih/zoom)/2'`,
        `zoompan=z='min(1.08+0.0006*on,1.28)':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*on/{F}'`,
        `zoompan=z='1.22':x='iw/2-(iw/zoom/2)':y='(ih-ih/zoom)*(1-on/{F})'`
      ];
    const transitions = gentle
      ? ['fade', 'dissolve']
      : ['fade', 'dissolve', 'wipeleft', 'wipeup', 'slideright', 'wipedown', 'slideleft', 'fadeblack'];

    const args = ['-y'];
    const filters = [];
    for (let i = 0; i < padded.length; i++) {
      const frames = Math.max(1, Math.round(padded[i].duration * fps));
      const motion = motions[i % motions.length].replaceAll('{F}', String(Math.max(1, frames - 1)));
      args.push('-i', padded[i].path);
      filters.push(`[${i}:v]scale=3072:1728:force_original_aspect_ratio=increase,crop=3072:1728,${motion}:d=${frames}:s=1920x1080:fps=${fps},format=yuv420p,setsar=1[v${i}]`);
    }

    if (padded.length === 1) {
      args.push('-filter_complex', `${filters[0].replace('[v0]', '[vout]')}`, '-map', '[vout]', '-c:v', 'libx264', '-r', String(fps), videoPath);
      await runFFmpeg(args);
      return videoPath;
    }

    let prev = '[v0]';
    let offset = padded[0].duration - fade;
    for (let i = 1; i < padded.length; i++) {
      const out = i === padded.length - 1 ? '[vout]' : `[x${i}]`;
      const transition = transitions[(i - 1) % transitions.length];
      filters.push(`${prev}[v${i}]xfade=transition=${transition}:duration=${fade.toFixed(2)}:offset=${offset.toFixed(2)}${out}`);
      offset += padded[i].duration - fade;
      prev = out;
    }

    args.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-c:v', 'libx264', '-r', String(fps), videoPath);
    await runFFmpeg(args);
    return videoPath;
  }

  async filterImageAssets(visualAssets = []) {
    const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
    const mimeTypes = {
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp'
    };
    const images = [];

    for (const asset of visualAssets) {
      if (typeof asset !== 'string' || !imageExtensions.has(path.extname(asset).toLowerCase())) {
        continue;
      }

      try {
        const imageBuffer = await fs.readFile(asset);
        const metadata = await sharp(imageBuffer, { failOn: 'error' }).metadata();
        const mimeType = mimeTypes[metadata.format];
        if (mimeType && metadata.width && metadata.height) {
          images.push(`data:${mimeType};base64,${imageBuffer.toString('base64')}`);
        }
      } catch (_error) {
        // Skip missing or invalid image files
      }
    }

    return images;
  }

  createSlideshowHTML(script, visualAssets) {
    return `
<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            margin: 0;
            padding: 0;
            width: 1920px;
            height: 1080px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            font-family: 'Arial', sans-serif;
            overflow: hidden;
        }
        
        .slide {
            position: absolute;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 2s ease-in-out;
        }
        
        .slide.active {
            opacity: 1;
        }
        
        .content {
            text-align: center;
            color: white;
            max-width: 80%;
        }
        
        h1 {
            font-size: 72px;
            margin-bottom: 30px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
        }
        
        h2 {
            font-size: 48px;
            margin-bottom: 20px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
        }
        
        p {
            font-size: 36px;
            line-height: 1.4;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.5);
        }
        
        .background-image {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            opacity: 0.3;
            z-index: -1;
        }
        
        .particles {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            z-index: -1;
        }
        
        .particle {
            position: absolute;
            background: rgba(255,255,255,0.8);
            border-radius: 50%;
            animation: float 6s ease-in-out infinite;
        }
        
        @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-20px); }
        }
    </style>
</head>
<body>
    <div class="particles"></div>
    
    <!-- Title Slide -->
    <div class="slide active">
        ${visualAssets[0] ? `<img class="background-image" src="${visualAssets[0]}" />` : ''}
        <div class="content">
            <h1>${script.title}</h1>
            <p>Ethereal Dreamscript</p>
        </div>
    </div>
    
    ${this.generateContentSlides(script, visualAssets).join('')}
    
    <!-- Subscribe Slide -->
    <div class="slide">
        <div class="content">
            <h2>✨ Subscribe for More Stories ✨</h2>
            <p>New content daily at 2:00 PM</p>
        </div>
    </div>
    
    <script>
        // Create floating particles
        function createParticles() {
            const container = document.querySelector('.particles');
            for (let i = 0; i < 20; i++) {
                const particle = document.createElement('div');
                particle.className = 'particle';
                particle.style.left = Math.random() * 100 + '%';
                particle.style.top = Math.random() * 100 + '%';
                particle.style.width = (Math.random() * 4 + 2) + 'px';
                particle.style.height = particle.style.width;
                particle.style.animationDelay = Math.random() * 6 + 's';
                container.appendChild(particle);
            }
        }
        
        let currentSlide = 0;
        const slides = document.querySelectorAll('.slide');
        
        function advanceAnimation() {
            slides[currentSlide].classList.remove('active');
            currentSlide = (currentSlide + 1) % slides.length;
            slides[currentSlide].classList.add('active');
        }
        
        window.advanceAnimation = advanceAnimation;
        createParticles();
    </script>
</body>
</html>`;
  }

  generateContentSlides(script, visualAssets) {
    const slides = [];
    
    if (script.mainContent && script.mainContent.sections) {
      script.mainContent.sections.forEach((section, index) => {
        const assetIndex = Math.min(index + 1, visualAssets.length - 1);
        
        slides.push(`
        <div class="slide">
            ${visualAssets[assetIndex] ? `<img class="background-image" src="${visualAssets[assetIndex]}" />` : ''}
            <div class="content">
                <h2>${section.title}</h2>
                ${this.formatSectionContent(section)}
            </div>
        </div>`);
      });
    }
    
    return slides;
  }

  formatSectionContent(section) {
    if (section.items && Array.isArray(section.items)) {
      return section.items.slice(0, 3).map(item => 
        `<p>${item.number}. ${item.title}</p>`
      ).join('');
    }
    
    if (section.steps && Array.isArray(section.steps)) {
      return section.steps.slice(0, 3).map(step => 
        `<p>${step.title}</p>`
      ).join('');
    }
    
    if (typeof section.content === 'string') {
      return `<p>${section.content.slice(0, 200)}${section.content.length > 200 ? '...' : ''}</p>`;
    }
    
    return '<p>Content coming soon...</p>';
  }

  calculateScriptDuration(script) {
    // Estimate duration based on word count (average 150 words per minute)
    let totalWords = 0;
    
    if (script.hook) totalWords += script.hook.text.split(' ').length;
    if (script.introduction) {
      totalWords += (script.introduction.greeting || '').split(' ').length;
      totalWords += (script.introduction.topicIntro || '').split(' ').length;
    }
    
    if (script.mainContent && script.mainContent.sections) {
      script.mainContent.sections.forEach(section => {
        if (typeof section.content === 'string') {
          totalWords += section.content.split(' ').length;
        } else if (Array.isArray(section.content)) {
          section.content.forEach(chunk => {
            if (typeof chunk === 'string') totalWords += chunk.split(' ').length;
          });
        }
        if (section.items) {
          section.items.forEach(item => {
            totalWords += (item.title + ' ' + item.description).split(' ').length;
          });
        }
        if (section.steps) {
          section.steps.forEach(step => {
            totalWords += (step.title + ' ' + step.description).split(' ').length;
          });
        }
      });
    }
    
    if (script.conclusion) {
      totalWords += script.conclusion.finalThought.split(' ').length;
    }
    
    // Convert to duration (150 words per minute)
    return Math.max(30, Math.ceil((totalWords / 150) * 60));
  }

  async addAudioToVideo(videoPath, audioPath, outputPath, options = {}) {
    const hasRealAudio = await this.isUsableAudioFile(audioPath);

    if (!hasRealAudio) {
      if (options.allowSilent === true) {
        this.logger.warn('Creating an intentionally silent video from an operator-confirmed override.');
        if (videoPath !== outputPath) await fs.copyFile(videoPath, outputPath);
        return outputPath;
      }
      const error = new Error('Narration audio is required. Regenerate narration or explicitly confirm an intentional silent video.');
      error.code = 'NARRATION_REQUIRED';
      throw error;
    }

    // FFmpeg cannot write to its own input, so mux to a temp file when paths collide
    const muxPath = outputPath === videoPath
      ? outputPath.replace(/\.mp4$/i, '_muxed.mp4')
      : outputPath;

    const videoInput = options.loopVideo ? ['-stream_loop', '-1', '-i', videoPath] : ['-i', videoPath];
    await runFFmpeg(['-y', ...videoInput, '-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-shortest', muxPath]);

    if (muxPath !== outputPath) {
      await fs.rename(muxPath, outputPath);
    }

    this.logger.info('Audio added to video successfully');
    return outputPath;
  }

  async isUsableAudioFile(audioPath) {
    if (typeof audioPath !== 'string' || audioPath.endsWith('.info')) {
      return false;
    }

    try {
      const stats = await fs.stat(audioPath);
      return stats.isFile() && stats.size > 0;
    } catch (error) {
      return false;
    }
  }

  async downloadVideo(url, outputPath) {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    const writer = require('fs').createWriteStream(outputPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  async cleanupDirectory(dirPath) {
    try {
      const files = await fs.readdir(dirPath);
      for (const file of files) {
        await fs.unlink(path.join(dirPath, file));
      }
      await fs.rmdir(dirPath);
    } catch (error) {
      this.logger.warn('Cleanup failed:', error.message);
    }
  }

  async generateThumbnail(script, style = "ethereal") {
    this.logger.info('Generating custom thumbnail...');

    try {
      if (!this.openai && !this.gemini) {
        return await this.simulateThumbnailGeneration(script, style);
      }

      const prompt = `YouTube thumbnail for "${script.title}", ${style} style, eye-catching, high contrast text, professional design, clickable, engaging`;
      const thumbnailPath = path.join(__dirname, '..', 'uploads', 'thumbnails', `thumbnail_${Date.now()}.png`);

      await this.generateImage(prompt, thumbnailPath);
      const metadata = await sharp(thumbnailPath).metadata();

      return {
        path: thumbnailPath,
        dimensions: { width: metadata.width, height: metadata.height },
        fileSize: await this.getFileSize(thumbnailPath)
      };
    } catch (error) {
      this.logger.error('Thumbnail generation failed:', error);
      return await this.simulateThumbnailGeneration(script, style);
    }
  }

  async getFileSize(filePath) {
    const stats = await fs.stat(filePath);
    return stats.size;
  }

  // Simulation methods for when APIs are not available
  async simulateTTSGeneration(text, outputPath) {
    this.logger.info('Simulating TTS generation...');
    
    const infoPath = outputPath + '.info';
    await fs.writeFile(infoPath, JSON.stringify({
      message: 'AI TTS audio would be generated here',
      text: text.substring(0, 100) + '...',
      timestamp: new Date().toISOString()
    }, null, 2));
    
    return infoPath;
  }

  async simulateVisualAssets(prompt, style, count) {
    this.logger.info(`Simulating ${count} visual assets...`);
    
    const paths = [];
    for (let i = 0; i < count; i++) {
      const assetPath = path.join(__dirname, '..', 'data', 'assets', `visual_sim_${Date.now()}_${i}.info`);
      
      await fs.writeFile(assetPath, JSON.stringify({
        message: 'AI visual asset would be generated here',
        prompt: prompt,
        style: style,
        timestamp: new Date().toISOString()
      }, null, 2));
      
      paths.push(assetPath);
    }
    
    return paths;
  }

  async simulateVideoGeneration(script, visualAssets, audioPath, outputPath) {
    this.logger.info('Simulating video generation...');
    
    const infoPath = outputPath + '.info';
    await fs.writeFile(infoPath, JSON.stringify({
      message: 'AI video would be generated here',
      script: script.title,
      visualAssets: visualAssets.length,
      audioPath: audioPath,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    return infoPath;
  }

  async simulateThumbnailGeneration(script, style) {
    this.logger.info('Simulating thumbnail generation...');
    
    const thumbnailPath = path.join(__dirname, '..', 'uploads', 'thumbnails', `thumbnail_sim_${Date.now()}.info`);
    await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
    
    await fs.writeFile(thumbnailPath, JSON.stringify({
      message: 'AI thumbnail would be generated here',
      title: script.title,
      style: style,
      timestamp: new Date().toISOString()
    }, null, 2));
    
    return {
      path: thumbnailPath,
      dimensions: { width: 1792, height: 1024 },
      fileSize: 1024,
      simulated: true
    };
  }
}

module.exports = { AIVideoGenerator };
