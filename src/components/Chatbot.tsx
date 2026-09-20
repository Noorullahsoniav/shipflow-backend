import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageCircle, X, Send, Loader2, Bot, User } from 'lucide-react';
import Markdown from 'react-markdown';

export function Chatbot({ orders = [], products = [] }: any) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'model', text: string }[]>([
    { role: 'model', text: 'السلام علیکم! میں آپ کا اسسٹنٹ ہوں۔ آپ مجھ سے اپنے آرڈرز، منافع، پروڈکٹس کے بارے میں کچھ بھی پوچھ سکتے ہیں۔ یا کسی بھی آرڈر کو ٹریک کروا سکتے ہیں۔' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput('');
    const newMessages = [...messages, { role: 'user' as const, text: userText }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      const simplifiedOrders = orders.map((o: any) => ({
        customerName: o.customerName,
        customerCity: o.customerCity,
        customerPhone: o.customerPhone,
        customerPhone2: o.customerPhone2 || '',
        partnerName: o.partnerName,
        status: o.status,
        trackingNumber: o.trackingNumber,
        totalAmount: o.totalAmount,
        totalProfit: o.totalProfit,
        createdAt: o.createdAt?.split('T')[0],
        items: o.items?.map((i:any) => ({ name: i.name, quantity: i.quantity }))
      }));

      const simplifiedProducts = products.map((p: any) => ({
        name: p.name,
        stock: p.stock,
        sellingPrice: p.sellingPrice,
        costPrice: p.costPrice
      }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          history: messages.length > 1 ? messages.slice(1) : [],
          context: {
            orders: simplifiedOrders,
            products: simplifiedProducts
          }
        })
      });

      if (!res.ok) {
        throw new Error('API Error');
      }

      const data = await res.json();
      setMessages(prev => [...prev, { role: 'model', text: data.text || 'معذرت، میں آپ کی بات سمجھ نہیں سکا' }]);
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'model', text: 'نیٹ ورک کا مسئلہ ہے، براہ کرم دوبارہ کوشش کریں۔' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => { setIsOpen(true); }}
        className={`fixed bottom-6 ${isOpen ? '-right-20' : 'right-6'} p-4 rounded-full bg-indigo-600 text-white shadow-xl hover:bg-indigo-700 hover:scale-105 active:scale-95 transition-all duration-300 z-50 flex items-center justify-center`}
        title="چیٹ بوٹ"
      >
        <MessageCircle className="w-6 h-6 animate-pulse" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.95 }}
            className="fixed bottom-6 right-6 w-[340px] sm:w-[410px] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden z-50 border border-slate-100/50"
            style={{ height: '620px', maxHeight: '82vh' }}
          >
            {/* Header with stylish Indigo gradient */}
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-5 text-white flex justify-between items-center shadow-md" dir="rtl">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0 border border-white/10 shadow-inner">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                  <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 border-2 border-indigo-600 rounded-full"></span>
                </div>
                <div>
                  <h3 className="font-bold text-sm tracking-wide sm:text-base">اسسٹنٹ چیٹ بوٹ</h3>
                  <p className="text-[10px] text-indigo-150/90 font-medium">ہمیشہ آپ کی مدد کے لیئے تیار</p>
                </div>
              </div>
              <button 
                onClick={() => setIsOpen(false)} 
                className="text-white/80 hover:text-white hover:bg-white/10 p-2 rounded-xl transition-all duration-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-slate-50/50" dir="rtl">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'mr-auto' : 'ml-auto animate-in fade-in slide-in-from-bottom-2'}`}>
                  {msg.role === 'model' && (
                    <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100/60 flex items-center justify-center shrink-0 shadow-xs">
                      <Bot className="w-4 h-4 text-indigo-600" />
                    </div>
                  )}
                  <div className={`p-3.5 rounded-2xl shadow-[0_2px_12px_rgba(99,102,241,0.02)] ${
                    msg.role === 'user' 
                      ? 'bg-indigo-600 text-white rounded-tr-sm shadow-[0_4px_12px_rgba(99,102,241,0.2)]' 
                      : 'bg-white border border-slate-100/80 text-slate-800 rounded-tl-sm'
                  }`}>
                    <div className={`markdown-body p-0 text-xs sm:text-sm leading-relaxed [&>p]:mb-2 last:[&>p]:mb-0 ${msg.role === 'user' ? 'text-white' : ''}`}>
                      <Markdown>{msg.text}</Markdown>
                    </div>
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-8 h-8 rounded-full bg-slate-200 border border-slate-300/40 flex items-center justify-center shrink-0 shadow-xs">
                      <User className="w-4 h-4 text-slate-600" />
                    </div>
                  )}
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-3 max-w-[85%] ml-auto animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100/60 flex items-center justify-center shrink-0">
                    <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
                  </div>
                  <div className="bg-white border border-slate-100 text-slate-800 p-3.5 rounded-2xl rounded-tl-sm shadow-[0_2px_12px_rgba(99,102,241,0.02)] flex items-center">
                    <div className="flex gap-1.5 px-1 py-0.5">
                      <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Form with modern elements */}
            <form onSubmit={handleSend} className="p-4 bg-white border-t border-slate-100" dir="rtl">
              <div className="flex items-end gap-2.5 relative">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend(e);
                    }
                  }}
                  placeholder="ٹریکنگ آئی ڈی یا کوئی سوال پوچھیں..."
                  className="flex-1 pr-4 pl-12 py-3 min-h-[48px] max-h-[120px] resize-none bg-slate-50 border border-slate-200 rounded-2xl focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 text-xs sm:text-sm overflow-hidden placeholder:text-gray-400 transition-all duration-200"
                  disabled={isLoading}
                  rows={1}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isLoading}
                  className="absolute left-2.5 bottom-1.5 p-2 text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 rounded-xl transition-all duration-200 shadow-sm active:scale-90"
                >
                  <Send className="w-4 h-4 rotate-180" />
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
