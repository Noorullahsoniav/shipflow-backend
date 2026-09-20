import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Mic, 
  Square, 
  Play, 
  Pause, 
  Upload, 
  Sparkles, 
  Check, 
  Loader2, 
  Volume2, 
  RefreshCw, 
  Trash2,
  Phone,
  MapPin,
  User,
  ShoppingBag,
  ExternalLink,
  ClipboardPaste,
  MessageCircle,
  AudioWaveform,
  Globe
} from 'lucide-react';
import toast from 'react-hot-toast';
import { 
  parseRawAddressDetails, 
  openWhatsAppDirectly, 
  readClipboardText, 
  ParsedAddressResult 
} from '../lib/addressParser';

export type ExtractedVoiceAddress = ParsedAddressResult;

interface VoiceAddressRecorderProps {
  onApply: (data: ExtractedVoiceAddress) => void;
  availableProducts?: Array<{ id: string; name: string; sellingPrice?: number }>;
  compact?: boolean;
}

export function VoiceAddressRecorder({ onApply, availableProducts = [], compact = false }: VoiceAddressRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeechRecognizing, setIsSpeechRecognizing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedVoiceAddress | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [speechLanguage, setSpeechLanguage] = useState<'ur-PK' | 'en-PK'>('ur-PK');
  const [hasWebSpeech, setHasWebSpeech] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const speechRecognitionRef = useRef<any>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<any>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptAccumulatorRef = useRef<string>('');

  useEffect(() => {
    // Check if Web Speech API is supported
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      setHasWebSpeech(!!SpeechRecognition);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch (e) {}
      }
    };
  }, [audioUrl]);

  // Start Voice Recording + Live Browser Speech Recognition
  const startRecording = async () => {
    setExtractedData(null);
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setFileName(null);
    setLiveTranscript('');
    transcriptAccumulatorRef.current = '';
    audioChunksRef.current = [];

    let mediaStream: MediaStream | null = null;

    // 1. Initialize MediaRecorder if mic access available
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        let mimeType = 'audio/webm';
        if (typeof MediaRecorder !== 'undefined') {
          if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
            mimeType = 'audio/webm;codecs=opus';
          } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
            mimeType = 'audio/ogg;codecs=opus';
          } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
            mimeType = 'audio/mp4';
          }

          const mediaRecorder = new MediaRecorder(mediaStream, { mimeType });
          mediaRecorderRef.current = mediaRecorder;

          mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
              audioChunksRef.current.push(event.data);
            }
          };

          mediaRecorder.onstop = () => {
            const finalBlob = new Blob(audioChunksRef.current, { type: mimeType });
            setAudioBlob(finalBlob);
            const url = URL.createObjectURL(finalBlob);
            setAudioUrl(url);

            // Release mic tracks
            if (mediaStream) {
              mediaStream.getTracks().forEach(track => track.stop());
            }

            // If we don't have transcript from live recognition, process via server
            if (!transcriptAccumulatorRef.current.trim()) {
              processAudioViaServer(finalBlob, mimeType);
            }
          };

          mediaRecorder.start(250);
          setIsRecording(true);
        }
      }
    } catch (err: any) {
      console.warn('MediaRecorder error or mic prompt:', err);
    }

    // 2. Initialize Live Browser Speech Recognition (Works with zero API keys on Chrome/Android)
    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        speechRecognitionRef.current = recognition;
        recognition.lang = speechLanguage;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          setIsSpeechRecognizing(true);
        };

        recognition.onresult = (event: any) => {
          let currentInterim = '';
          let currentFinal = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              currentFinal += transcript + ' ';
            } else {
              currentInterim += transcript;
            }
          }

          if (currentFinal) {
            transcriptAccumulatorRef.current += currentFinal;
          }

          const combinedText = (transcriptAccumulatorRef.current + currentInterim).trim();
          setLiveTranscript(combinedText);
        };

        recognition.onerror = (event: any) => {
          console.warn('Speech recognition error event:', event.error);
          if (event.error === 'not-allowed') {
            toast.error('براؤزر میں مائیکروفون کی اجازت نہیں ملی۔');
          }
        };

        recognition.onend = () => {
          setIsSpeechRecognizing(false);
        };

        recognition.start();
        setIsSpeechRecognizing(true);
      }
    } catch (speechErr) {
      console.warn('Live speech recognition setup error:', speechErr);
    }

    setIsRecording(true);
    setRecordingTime(0);

    timerRef.current = setInterval(() => {
      setRecordingTime(prev => prev + 1);
    }, 1000);

    toast('مائیک آن ہے! گاہک کا نام، پتہ، شہر اور فون بولیں یا وائس نوٹ چلائیں 🎙️', {
      icon: '🎙️',
      duration: 3500
    });
  };

  // Stop Recording and Parse Speech
  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);

    // Stop live recognition
    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch (e) {}
    }
    setIsSpeechRecognizing(false);

    // Stop media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
    }

    // Process recognized text immediately if we captured speech!
    const textToProcess = (transcriptAccumulatorRef.current || liveTranscript).trim();
    if (textToProcess) {
      setIsProcessing(true);
      setTimeout(() => {
        const parsed = parseRawAddressDetails(textToProcess, availableProducts);
        setExtractedData(parsed);
        setIsProcessing(false);
        toast.success('وائس نوٹ کی معلومات فوری طور پر سمجھ لی گئیں! ✨');
      }, 300);
    } else {
      toast('کوئی آواز موصول نہیں ہوئی۔ براہ کرم دوبارہ کوشش کریں یا فائل اپلوڈ کریں۔', { icon: 'ℹ️' });
    }
  };

  // Process file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processUploadedFile(file);
  };

  const processUploadedFile = (file: File) => {
    setFileName(file.name);
    setExtractedData(null);
    setAudioBlob(file);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);

    let mime = file.type || 'audio/ogg';
    if (file.name.endsWith('.opus')) mime = 'audio/ogg';
    if (file.name.endsWith('.m4a')) mime = 'audio/mp4';
    if (file.name.endsWith('.mp3')) mime = 'audio/mp3';
    if (file.name.endsWith('.wav')) mime = 'audio/wav';

    processAudioViaServer(file, mime);
  };

  // Send audio to server endpoint
  const processAudioViaServer = async (blob: Blob, mimeType: string) => {
    setIsProcessing(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64Audio = reader.result as string;

        try {
          const res = await fetch('/api/process-voice-address', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64: base64Audio,
              mimeType: mimeType || blob.type || 'audio/webm',
              availableProducts
            })
          });

          const data = await res.json();
          if (res.ok && data && (data.customerName || data.customerAddress || data.customerPhone || data.customerCity)) {
            setExtractedData(data);
            toast.success('وائس نوٹ کامیابی سے سمجھ لیا گیا اور ایڈریس نکل آیا! ✨');
          } else {
            // If server AI was unable to parse, provide friendly client helper
            throw new Error(data.urduMessage || data.error || 'سرور سے وائس نوٹ پروسیس نہیں ہو سکا');
          }
        } catch (apiErr: any) {
          console.warn('API Voice Note Process note:', apiErr);
          // Fallback: If user has live transcript, use it
          const fallbackText = (transcriptAccumulatorRef.current || liveTranscript).trim();
          if (fallbackText) {
            const parsed = parseRawAddressDetails(fallbackText, availableProducts);
            setExtractedData(parsed);
            toast.success('مائیکروفون سے ایڈریس حاصل کر لیا گیا! ✅');
          } else {
            toast('وائس نوٹ لوڈ ہو گیا ہے۔ آپ اسے پلے کر سکتے ہیں یا مائیکروفون میں بول سکتے ہیں 🎙️', {
              icon: '🎵',
              duration: 4000
            });
          }
        } finally {
          setIsProcessing(false);
        }
      };
    } catch (err: any) {
      console.error(err);
      setIsProcessing(false);
      toast.error('آڈیو فائل لوڈ کرنے میں دشواری ہوئی۔');
    }
  };

  // Action: Open WhatsApp directly on Mobile or Desktop
  const handleOpenWhatsApp = () => {
    openWhatsAppDirectly();
    toast.success('واٹس ایپ کھل گیا ہے! وہاں سے گاہک کا وائس نوٹ یا ایڈریس کاپی کریں 📲', {
      duration: 4000,
      icon: '💬'
    });
  };

  // Action: Quick Paste from Clipboard
  const handlePasteFromClipboard = async () => {
    try {
      const clipboardText = await readClipboardText();
      if (clipboardText) {
        setIsProcessing(true);
        setTimeout(() => {
          const parsed = parseRawAddressDetails(clipboardText, availableProducts);
          setExtractedData(parsed);
          setLiveTranscript(clipboardText);
          setIsProcessing(false);
          toast.success('واٹس ایپ سے کاپی شدہ ایڈریس خودکار فل ہو گیا! ✨');
        }, 200);
      } else {
        toast('کلپ بورڈ خالی ہے! واٹس ایپ سے گاہک کا ایڈریس میسج کاپی کر کے آئیں 📋', { icon: '📋' });
      }
    } catch (err) {
      toast.error('کلپ بورڈ پڑھنے کی اجازت نہیں ملی۔ ٹیکسٹ باکس میں پیسٹ کریں۔');
    }
  };

  const handleTogglePlay = () => {
    if (!audioPlayerRef.current) return;
    if (isPlaying) {
      audioPlayerRef.current.pause();
      setIsPlaying(false);
    } else {
      audioPlayerRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleApply = () => {
    if (!extractedData) return;
    onApply(extractedData);
    toast.success('تمام تفصیلات آرڈر فارم میں درج کر دی گئی ہیں! ✅');
  };

  const resetAll = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current && isRecording) {
      try { mediaRecorderRef.current.stop(); } catch (e) {}
    }
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch (e) {}
    }
    setIsRecording(false);
    setIsSpeechRecognizing(false);
    setAudioBlob(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setExtractedData(null);
    setLiveTranscript('');
    transcriptAccumulatorRef.current = '';
    setFileName(null);
    setIsPlaying(false);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="bg-gradient-to-br from-indigo-50/90 via-violet-50/50 to-purple-50/70 p-4 rounded-2xl border-2 border-indigo-200/80 shadow-sm space-y-3.5 text-right" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-sm shadow-emerald-200">
            <Mic className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-black text-indigo-950 flex items-center gap-1.5">
              <span>گاہک کا وائس نوٹ / مائیکروفون ایڈریس</span>
              <span className="bg-emerald-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 animate-pulse">
                <span>لائیو وائس</span>
                <Sparkles className="w-2.5 h-2.5" />
              </span>
            </h4>
            <p className="text-[10px] text-indigo-800/80 font-medium">
              بولیں، واٹس ایپ نوٹ سنیں، یا واٹس ایپ سے براہِ راست سلیکٹ کریں
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Language toggle for speech recognition */}
          <button
            type="button"
            onClick={() => setSpeechLanguage(prev => prev === 'ur-PK' ? 'en-PK' : 'ur-PK')}
            className="text-[10px] font-bold bg-white text-indigo-700 px-2 py-1 rounded-lg border border-indigo-200 hover:bg-indigo-50 transition-colors flex items-center gap-1"
            title="زبان تبدیل کریں"
          >
            <Globe className="w-3 h-3 text-indigo-500" />
            <span>{speechLanguage === 'ur-PK' ? 'اردو (PK)' : 'English'}</span>
          </button>

          {(audioBlob || extractedData || liveTranscript) && (
            <button
              type="button"
              onClick={resetAll}
              className="text-[11px] font-bold text-gray-500 hover:text-red-600 flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-gray-200 transition-colors shadow-xs"
              title="دوبارہ شروع کریں"
            >
              <Trash2 className="w-3 h-3" />
              <span>نیا</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Action Cards: Mic, WhatsApp Direct, File Upload */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {/* 1. Live Mic Speech Recognition */}
        <div className={`p-3 rounded-xl border transition-all flex flex-col justify-between ${
          isRecording 
            ? 'bg-red-50 border-red-300 ring-2 ring-red-200 shadow-sm' 
            : 'bg-white border-indigo-100 hover:border-indigo-300 shadow-xs'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
              {isRecording ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
                  <span className="text-red-700 font-black">سن رہا ہے... ({formatTime(recordingTime)})</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5 text-indigo-600" />
                  <span>مائیکروفون میں بولیں</span>
                </>
              )}
            </span>
            {isRecording && (
              <span className="text-[10px] font-mono font-black text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">
                {formatTime(recordingTime)}
              </span>
            )}
          </div>

          <div>
            {isRecording ? (
              <button
                type="button"
                onClick={stopRecording}
                className="w-full bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-black text-xs py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>بولنا مکمل ہوا (ایڈریس نکالیں)</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={startRecording}
                disabled={isProcessing}
                className="w-full bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold text-xs py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
              >
                <Mic className="w-3.5 h-3.5 animate-bounce" />
                <span>مائیکروفون آن کریں 🎙️</span>
              </button>
            )}
          </div>
        </div>

        {/* 2. Direct WhatsApp Button (Opens WhatsApp Directly!) */}
        <div className="p-3 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 hover:border-emerald-300 transition-all flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-emerald-950 flex items-center gap-1.5">
              <MessageCircle className="w-4 h-4 text-emerald-600" />
              <span>واٹس ایپ سے حاصل کریں</span>
            </span>
            <span className="text-[9px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
              ڈائریکٹ
            </span>
          </div>
          
          <div className="space-y-1.5">
            <a
              href="https://api.whatsapp.com/send"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                toast('واٹس ایپ کھل رہی ہے... گاہک کا وائس نوٹ یا میسج کاپی کریں 📲', { icon: '💬' });
              }}
              className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-xs py-1.5 px-2.5 rounded-lg flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer no-underline"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>واٹس ایپ کھولیں 📲</span>
            </a>

            <button
              type="button"
              onClick={handlePasteFromClipboard}
              className="w-full bg-white hover:bg-emerald-100/50 text-emerald-800 border border-emerald-300 font-bold text-[11px] py-1 px-2 rounded-lg flex items-center justify-center gap-1 transition-all cursor-pointer"
              title="واٹس ایپ سے کاپی کیا ہوا میسج یہاں پیسٹ کریں"
            >
              <ClipboardPaste className="w-3 h-3 text-emerald-600" />
              <span>کاپی شدہ پیسٹ کریں</span>
            </button>
          </div>
        </div>

        {/* 3. Audio File Upload Card */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="p-3 rounded-xl border-2 border-dashed border-indigo-200 bg-white hover:bg-indigo-50/60 transition-all cursor-pointer flex flex-col justify-between items-center text-center shadow-xs"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.opus,.ogg,.mp3,.m4a,.wav,.aac,.webm,.amr"
            onChange={handleFileUpload}
            className="hidden"
          />
          <div className="flex flex-col items-center">
            <Upload className="w-4 h-4 text-indigo-600 mb-1" />
            <span className="text-xs font-bold text-indigo-950 truncate max-w-full">
              {fileName ? fileName : 'وائس فائل اپلوڈ کریں'}
            </span>
            <span className="text-[10px] text-gray-500 mt-0.5">
              واٹس ایپ نوٹ (.opus, .m4a, .mp3)
            </span>
          </div>

          <span className="text-[10px] text-indigo-600 font-bold mt-1 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
            فائل منتخب کریں 📁
          </span>
        </div>
      </div>

      {/* Live Speaking Waves & Interim Transcript */}
      {isRecording && (
        <div className="bg-white p-3 rounded-xl border border-red-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-red-700 flex items-center gap-1.5">
              <span className="flex h-2 w-2 rounded-full bg-red-600 animate-ping" />
              <span>براہِ راست آپ کی آواز سنی جا رہی ہے:</span>
            </span>
            <span className="text-[10px] text-gray-500 font-medium">
              (نام، فون، شہر اور پتہ بولیں)
            </span>
          </div>

          <div className="min-h-10 max-h-24 overflow-y-auto p-2 bg-slate-50 rounded-lg border border-slate-200 text-xs font-medium text-slate-800 leading-relaxed text-right">
            {liveTranscript ? (
              <span className="text-indigo-950 font-bold">{liveTranscript}</span>
            ) : (
              <span className="text-gray-400 italic">آواز کا انتظار ہے... مائیکروفون میں صاف بولیں۔</span>
            )}
          </div>
        </div>
      )}

      {/* Audio Player preview if available */}
      {audioUrl && !isRecording && (
        <div className="bg-white p-2.5 rounded-xl border border-indigo-100 flex items-center justify-between gap-3 shadow-xs">
          <audio
            ref={audioPlayerRef}
            src={audioUrl}
            onEnded={() => setIsPlaying(false)}
            className="hidden"
          />
          <button
            type="button"
            onClick={handleTogglePlay}
            className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 flex items-center justify-center shrink-0 transition-colors"
            title={isPlaying ? 'روکیں' : 'سنیں'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 mr-0.5" />}
          </button>
          
          <div className="flex-1 flex items-center gap-2 overflow-hidden">
            <Volume2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <div className="text-right overflow-hidden">
              <p className="text-xs font-bold text-gray-800 truncate">
                {fileName || 'ریکارڈ شدہ آڈیو نوٹ'}
              </p>
              <p className="text-[10px] text-gray-500">
                {isPlaying ? 'چل رہا ہے...' : 'آڈیو تیار ہے'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              if (liveTranscript) {
                const parsed = parseRawAddressDetails(liveTranscript, availableProducts);
                setExtractedData(parsed);
              } else if (audioBlob) {
                processAudioViaServer(audioBlob, audioBlob.type || 'audio/webm');
              }
            }}
            disabled={isProcessing}
            className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 text-[11px] font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 shrink-0 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isProcessing ? 'animate-spin' : ''}`} />
            <span>دوبارہ سمجھیں</span>
          </button>
        </div>
      )}

      {/* Processing Loader */}
      {isProcessing && (
        <div className="bg-indigo-600 text-white p-3 rounded-xl flex items-center justify-center gap-3 shadow-md animate-pulse">
          <Loader2 className="w-5 h-5 animate-spin" />
          <div className="text-right">
            <p className="text-xs font-bold">وائس نوٹ سنا جا رہا ہے اور ایڈریس نکالا جا رہا ہے...</p>
            <p className="text-[10px] text-indigo-100">نام، فون، شہر اور پتہ خودکار طریقے سے ترتیب دیا جا رہا ہے ✨</p>
          </div>
        </div>
      )}

      {/* Extracted Details Result Card */}
      <AnimatePresence>
        {extractedData && !isProcessing && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-white rounded-xl p-3.5 border-2 border-emerald-300 shadow-md space-y-3"
          >
            <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
              <div className="flex items-center gap-1.5 text-emerald-900 font-black text-xs">
                <Check className="w-4 h-4 text-emerald-600 bg-emerald-100 p-0.5 rounded-full" />
                <span>وائس نوٹ سے حاصل شدہ معلومات:</span>
              </div>
              <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                100% تیار
              </span>
            </div>

            {/* Transcription Quote if any */}
            {(extractedData.transcription || liveTranscript) && (
              <div className="bg-slate-50 p-2 rounded-lg border border-slate-200/80 text-[11px] text-slate-700 italic">
                <span className="font-bold text-slate-900 not-italic ml-1">پیغام:</span>
                "{extractedData.transcription || liveTranscript}"
              </div>
            )}

            {/* Structured Fields Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="bg-gray-50/80 p-2 rounded-lg border border-gray-100 flex items-center gap-2">
                <User className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <div className="overflow-hidden">
                  <span className="text-[10px] text-gray-500 block">گاہک کا نام:</span>
                  <strong className="text-gray-900 truncate block">{extractedData.customerName || 'نامعلوم'}</strong>
                </div>
              </div>

              <div className="bg-gray-50/80 p-2 rounded-lg border border-gray-100 flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <div className="overflow-hidden">
                  <span className="text-[10px] text-gray-500 block">فون نمبر:</span>
                  <strong className="text-gray-900 font-mono block" dir="ltr">
                    {extractedData.customerPhone || 'نامعلوم'}
                    {extractedData.customerPhone2 ? ` / ${extractedData.customerPhone2}` : ''}
                  </strong>
                </div>
              </div>

              <div className="bg-gray-50/80 p-2 rounded-lg border border-gray-100 flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <div className="overflow-hidden">
                  <span className="text-[10px] text-gray-500 block">شہر (City):</span>
                  <strong className="text-gray-900 truncate block">{extractedData.customerCity || 'نامعلوم'}</strong>
                </div>
              </div>

              {extractedData.totalAmount && extractedData.totalAmount > 0 ? (
                <div className="bg-gray-50/80 p-2 rounded-lg border border-gray-100 flex items-center gap-2">
                  <ShoppingBag className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <div>
                    <span className="text-[10px] text-gray-500 block">COD رقم:</span>
                    <strong className="text-emerald-700 font-bold">Rs {extractedData.totalAmount.toLocaleString()}</strong>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Address */}
            <div className="bg-emerald-50/60 p-2 rounded-lg border border-emerald-100 text-xs">
              <span className="text-[10px] text-emerald-800 font-bold block mb-0.5">مکمل پتہ (Address):</span>
              <p className="text-emerald-950 font-medium leading-relaxed">
                {extractedData.customerAddress || 'پتہ درج نہیں ہوا'}
              </p>
            </div>

            {/* Apply Button */}
            <button
              type="button"
              onClick={handleApply}
              className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-black text-xs py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 shadow-md hover:shadow-lg transition-all cursor-pointer"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>یہ ایڈریس اور تفصیلات فارم میں بھریں ✨ (Apply to Order Form)</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
