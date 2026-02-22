import { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import { Play, Pause, Download, Settings2, Mic2, Sparkles, Volume2, Loader2, AudioWaveform } from 'lucide-react';
import { motion } from 'motion/react';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];
const EMOTIONS = ['Neutral', 'Calm', 'Emotional', 'Deep', 'Energetic', 'Storytelling'];
const LANGUAGES = ['English', 'Urdu', 'Spanish', 'French', 'Arabic'];
const SPEEDS = ['Very Slow', 'Slow', 'Normal', 'Fast', 'Very Fast'];

const WAVEFORM_HEIGHTS = [
  20, 35, 25, 50, 40, 60, 30, 45, 70, 55, 
  80, 65, 40, 55, 35, 60, 45, 30, 50, 25,
  35, 60, 45, 80, 55, 70, 40, 65, 30, 50,
  25, 45, 35, 60, 40, 55, 30, 45, 20, 35
];

function pcmToWav(base64Pcm: string, sampleRate: number = 24000): string {
  try {
    const binaryString = atob(base64Pcm);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const buffer = bytes.buffer;
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    
    const writeString = (view: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + bytes.length, true);
    writeString(view, 8, 'WAVE');
    
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    
    writeString(view, 36, 'data');
    view.setUint32(40, bytes.length, true);
    
    const wavBlob = new Blob([wavHeader, buffer], { type: 'audio/wav' });
    return URL.createObjectURL(wavBlob);
  } catch (e) {
    console.error("Error converting PCM to WAV:", e);
    throw new Error("Audio conversion failed.");
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'tts' | 'clone'>('tts');
  const [text, setText] = useState('');
  const [voice, setVoice] = useState('Zephyr');
  const [emotion, setEmotion] = useState('Neutral');
  const [language, setLanguage] = useState('English');
  const [speed, setSpeed] = useState<number>(1.0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Voice Cloning State
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneName, setCloneName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type.includes('audio')) {
        setCloneFile(file);
      } else {
        alert('Please upload a valid audio file (MP3, WAV, etc).');
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.includes('audio')) {
        setCloneFile(file);
      } else {
        alert('Please upload a valid audio file (MP3, WAV, etc).');
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleCloneSubmit = () => {
    if (!cloneFile || !cloneName.trim()) return;
    alert(`Voice "${cloneName}" submitted for cloning!\n\n(Note: This is a UI demonstration. The Gemini API currently only supports prebuilt voices for TTS.)`);
    setCloneFile(null);
    setCloneName('');
  };

  const handleGenerate = async () => {
    if (!text.trim()) return;
    setIsGenerating(true);
    setAudioSrc(null);
    setIsPlaying(false);
    
    try {
      let prompt = text;
      const adverbs = [];
      
      if (emotion === 'Calm') adverbs.push('calmly');
      else if (emotion === 'Emotional') adverbs.push('emotionally');
      else if (emotion === 'Deep') adverbs.push('deeply');
      else if (emotion === 'Energetic') adverbs.push('energetically');
      else if (emotion === 'Storytelling') adverbs.push('expressively');
      
      if (speed <= 0.6) adverbs.push('very slowly');
      else if (speed < 1.0) adverbs.push('slowly');
      else if (speed > 1.0 && speed <= 1.5) adverbs.push('quickly');
      else if (speed > 1.5) adverbs.push('very quickly');

      if (adverbs.length > 0) {
        prompt = `Say ${adverbs.join(' and ')}: ${text}`;
      } else {
        prompt = `Say: ${text}`;
      }

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice },
            },
          },
        },
      });

      if (!response.candidates || response.candidates.length === 0) {
        throw new Error("No candidates returned. The prompt may have been blocked by safety filters.");
      }

      const part = response.candidates[0]?.content?.parts?.[0];
      
      if (!part) {
        throw new Error("Empty response from the model.");
      }

      const base64Audio = part.inlineData?.data;
      
      if (base64Audio) {
        // Check if the base64 string starts with the RIFF header (WAV file)
        const isWav = base64Audio.startsWith('UklGR');
        
        if (isWav) {
          const src = `data:audio/wav;base64,${base64Audio}`;
          setAudioSrc(src);
        } else {
          const src = pcmToWav(base64Audio, 24000);
          setAudioSrc(src);
        }
      } else if (part.text) {
        throw new Error(`Model returned text instead of audio: "${part.text}"`);
      } else {
        throw new Error("No audio data received from the API.");
      }
    } catch (error: any) {
      console.error("Error generating audio:", error);
      alert(`Failed to generate audio: ${error?.message || 'Unknown error'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      const onEnded = () => setIsPlaying(false);
      const onPlay = () => setIsPlaying(true);
      const onPause = () => setIsPlaying(false);
      
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('play', onPlay);
      audio.addEventListener('pause', onPause);
      
      return () => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('play', onPlay);
        audio.removeEventListener('pause', onPause);
      };
    }
  }, [audioSrc]);

  const handleDownload = () => {
    if (audioSrc) {
      const a = document.createElement('a');
      a.href = audioSrc;
      a.download = `vocalis_${voice.toLowerCase()}_${new Date().getTime()}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-indigo-500/30">
      {/* Header */}
      <header className="border-b border-zinc-800/50 bg-zinc-950/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <AudioWaveform className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Vocalis AI</h1>
          </div>
          <div className="flex items-center gap-2 text-sm font-medium bg-zinc-900/50 p-1 rounded-lg border border-zinc-800/50">
            <button 
              onClick={() => setActiveTab('tts')}
              className={`px-4 py-1.5 rounded-md transition-all ${activeTab === 'tts' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              Text to Speech
            </button>
            <button 
              onClick={() => setActiveTab('clone')}
              className={`px-4 py-1.5 rounded-md transition-all flex items-center gap-2 ${activeTab === 'clone' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              Voice Cloning
              <span className="text-[9px] uppercase tracking-wider bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded font-bold">Beta</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {activeTab === 'tts' ? (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-8"
          >
            {/* Left Column: Controls */}
            <div className="lg:col-span-1 space-y-6">
              <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl p-5 space-y-6 shadow-xl shadow-black/20">
                <div className="flex items-center gap-2 text-zinc-100 font-medium pb-4 border-b border-zinc-800/50">
                  <Settings2 className="w-4 h-4 text-zinc-400" />
                  Voice Settings
                </div>
                
                <div className="space-y-3">
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">AI Voice</label>
                  <div className="grid grid-cols-2 gap-2">
                    {VOICES.map(v => (
                      <button
                        key={v}
                        onClick={() => setVoice(v)}
                        className={`px-3 py-2.5 rounded-xl text-sm font-medium transition-all border ${
                          voice === v 
                            ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-300 shadow-inner shadow-indigo-500/10' 
                            : 'bg-zinc-950/50 border-zinc-800/80 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Language</label>
                  <select 
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full bg-zinc-950/50 border border-zinc-800/80 rounded-xl px-3 py-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-shadow appearance-none cursor-pointer"
                  >
                    {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>

                <div className="space-y-3">
                  <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Emotion & Style</label>
                  <select 
                    value={emotion}
                    onChange={(e) => setEmotion(e.target.value)}
                    className="w-full bg-zinc-950/50 border border-zinc-800/80 rounded-xl px-3 py-3 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-shadow appearance-none cursor-pointer"
                  >
                    {EMOTIONS.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Speed</label>
                    <span className="text-xs font-medium text-zinc-400">{speed.toFixed(1)}x</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.5" 
                    max="2.0" 
                    step="0.1" 
                    value={speed}
                    onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500 bg-zinc-800 h-2 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-zinc-500 font-medium">
                    <span>0.5x</span>
                    <span>1.0x</span>
                    <span>2.0x</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Text Input & Player */}
            <div className="lg:col-span-2 space-y-6 flex flex-col">
              <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl p-1 flex-grow flex flex-col relative focus-within:ring-1 focus-within:ring-indigo-500/50 transition-all shadow-xl shadow-black/20">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Type or paste your text here to generate ultra-realistic speech..."
                  className="w-full h-64 lg:h-full bg-transparent resize-none p-6 text-zinc-200 placeholder:text-zinc-600 focus:outline-none text-lg leading-relaxed"
                />
                <div className="absolute bottom-4 right-6 text-xs text-zinc-500 font-medium">
                  {text.length} characters
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !text.trim()}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white px-6 py-4 rounded-2xl font-medium transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 disabled:shadow-none"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Synthesizing Voice...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      Generate Speech
                    </>
                  )}
                </button>
              </div>

              {/* Audio Player */}
              {audioSrc && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-5 flex items-center gap-6 shadow-xl shadow-black/20"
                >
                  <button
                    onClick={togglePlay}
                    className="w-14 h-14 rounded-full bg-indigo-500 text-white flex items-center justify-center hover:bg-indigo-400 transition-colors flex-shrink-0 shadow-lg shadow-indigo-500/20"
                  >
                    {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
                  </button>
                  
                  <div className="flex-grow flex items-center justify-between gap-1 h-12 overflow-hidden px-2">
                    {WAVEFORM_HEIGHTS.map((height, i) => (
                      <div 
                        key={i} 
                        className={`w-1.5 rounded-full transition-all duration-300 ${isPlaying ? 'bg-indigo-400 animate-pulse' : 'bg-zinc-700'}`}
                        style={{ 
                          height: isPlaying ? `${height}%` : '20%',
                          animationDelay: `${i * 0.05}s`,
                          animationDuration: '0.8s'
                        }}
                      />
                    ))}
                  </div>

                  <button
                    onClick={handleDownload}
                    className="w-12 h-12 rounded-xl bg-zinc-800 text-zinc-300 flex items-center justify-center hover:bg-zinc-700 hover:text-white transition-colors flex-shrink-0"
                    title="Download Audio"
                  >
                    <Download className="w-5 h-5" />
                  </button>
                  
                  <audio ref={audioRef} src={audioSrc} className="hidden" />
                </motion.div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-24 text-center max-w-lg mx-auto space-y-8"
          >
            <div className="w-24 h-24 rounded-3xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shadow-2xl shadow-indigo-500/10">
              <Mic2 className="w-12 h-12 text-indigo-400" />
            </div>
            <div className="space-y-3">
              <h2 className="text-3xl font-semibold tracking-tight text-white">Instant Voice Cloning</h2>
              <p className="text-zinc-400 text-lg leading-relaxed">
                Upload a 1-minute audio sample to create a custom AI voice clone. This feature is currently in closed beta.
              </p>
            </div>
            
            <div className="w-full space-y-4">
              <div className="text-left space-y-2">
                <label className="text-sm font-medium text-zinc-300 ml-1">Voice Name</label>
                <input 
                  type="text" 
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  placeholder="e.g. My Custom Voice"
                  className="w-full bg-zinc-900/50 border border-zinc-800/80 rounded-xl px-4 py-3 text-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-shadow"
                />
              </div>

              <div 
                className={`p-8 bg-zinc-900/40 border-2 rounded-3xl w-full border-dashed transition-colors group ${cloneFile ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-zinc-800/80 hover:border-indigo-500/30 cursor-pointer'}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={() => !cloneFile && fileInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  accept="audio/*" 
                  className="hidden" 
                />
                
                <div className="flex flex-col items-center gap-4">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${cloneFile ? 'bg-indigo-500/20' : 'bg-zinc-800/50 group-hover:bg-zinc-800'}`}>
                    <Volume2 className={`w-8 h-8 ${cloneFile ? 'text-indigo-400' : 'text-zinc-500 group-hover:text-zinc-400'}`} />
                  </div>
                  <div className="space-y-1">
                    <div className="text-base font-medium text-zinc-300">
                      {cloneFile ? cloneFile.name : 'Drop your audio file here'}
                    </div>
                    <div className="text-sm text-zinc-500">
                      {cloneFile ? `${(cloneFile.size / (1024 * 1024)).toFixed(2)} MB` : 'Supports MP3, WAV up to 10MB'}
                    </div>
                  </div>
                  
                  {!cloneFile && (
                    <button className="mt-4 px-6 py-2.5 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white rounded-xl text-sm font-medium transition-colors">
                      Browse Files
                    </button>
                  )}
                </div>
              </div>

              <button 
                onClick={handleCloneSubmit}
                disabled={!cloneFile || !cloneName.trim()}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white px-6 py-4 rounded-2xl font-medium transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 disabled:shadow-none mt-6"
              >
                <Sparkles className="w-5 h-5" />
                Clone Voice
              </button>
              
              {cloneFile && (
                <button 
                  onClick={() => setCloneFile(null)}
                  className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Remove file
                </button>
              )}
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
}
