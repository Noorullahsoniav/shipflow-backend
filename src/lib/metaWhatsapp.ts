export interface MetaSendResult {
  success: boolean;
  httpStatus?: number;
  messageId?: string;
  errorCode?: number;
  errorMessage?: string;
  urduAdvice?: string;
  rawResponse?: any;
  sentPayload?: any;
  recipientPhoneFormatted?: string;
  timestamp?: string;
}

export function formatPhoneForMeta(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0092')) {
    cleaned = cleaned.slice(2);
  } else if (cleaned.startsWith('03')) {
    cleaned = '92' + cleaned.slice(1);
  } else if (cleaned.length === 10 && cleaned.startsWith('3')) {
    cleaned = '92' + cleaned;
  }
  return cleaned;
}

export function parseMetaError(resData: any, httpStatus?: number): { code: number; message: string; urduAdvice: string } {
  const err = resData?.error || {};
  const code = err.code || 0;
  const subcode = err.error_subcode || 0;
  const rawMsg = err.message || err.error_data?.details || (resData ? JSON.stringify(resData) : 'Unknown Meta API Error');

  let urduAdvice = '';

  if (code === 131047 || code === 132001 || subcode === 2494010) {
    urduAdvice = '⚠️ [24 گھنٹے کا واٹس ایپ سیشن ختم Error 131047]: گاہک نے پچھلے 24 گھنٹوں میں آپ کو واٹس ایپ پر میسج نہیں کیا۔ میٹا صرف Approved Template (مثلاً hello_world) بھیجنے دیتا ہے۔ آپ "ٹیمپلیٹ موڈ" منتخب کریں یا گاہک کو پہلا واٹس ایپ میسج بھیجنے کا کہیں۔';
  } else if (code === 190 || subcode === 463 || httpStatus === 401) {
    urduAdvice = '🔐 [ٹوکن نامکمل/ایکسپائر Error 190]: Access Token غلط ہے یا ختم ہو چکا ہے۔ Meta Developer Console میں جا کر نیا Permanent System User Access Token حاصل کریں۔';
  } else if (code === 100 || code === 1004 || httpStatus === 404) {
    urduAdvice = '❌ [Phone Number ID غلط Error 100]: Phone Number ID غلط ہے یا Phone ID درست میٹا ایپ میں رجسٹرڈ نہیں ہے۔';
  } else if (code === 131030) {
    urduAdvice = '🛑 [ٹیسٹ اکاؤنٹ کی محدودیت Error 131030]: آپ میٹا کا فری Test Number استعمال کر رہے ہیں۔ ٹیسٹ موڈ میں میسج صرف ان نمبرز پر جا سکتا ہے جو آپ نے Meta Dashboard کے "To Phone Number" میں پہلے سے ایڈ (Add) کیے ہوں۔';
  } else if (code === 131026) {
    urduAdvice = '📱 [نمبر غیر فعال Error 131026]: یہ فون نمبر واٹس ایپ پر موجود نہیں ہے یا میٹا کی طرف سے بلاک ہے۔';
  } else if (code === 132000) {
    urduAdvice = '📋 [ٹیمپلیٹ نہیں ملا Error 132000]: فراہم کردہ Template Name یا Language Code غلط ہے۔ Meta Dashboard پر Approve شدہ ٹیمپلیٹ کا درست نام درج کریں۔';
  } else {
    urduAdvice = `❌ [میٹا ایرر ${code || httpStatus}]: ${rawMsg}`;
  }

  return { code, message: rawMsg, urduAdvice };
}

export async function checkMetaAccountInfo({
  phoneNumberId,
  accessToken,
}: {
  phoneNumberId: string;
  accessToken: string;
}): Promise<{
  success: boolean;
  httpStatus?: number;
  data?: any;
  errorMessage?: string;
  urduAdvice?: string;
}> {
  if (!phoneNumberId || !accessToken) {
    return {
      success: false,
      errorMessage: 'Phone Number ID and Access Token required',
      urduAdvice: 'Phone Number ID اور Access Token دونوں درج کریں۔',
    };
  }

  try {
    const url = `https://graph.facebook.com/v20.0/${phoneNumberId.trim()}?fields=verified_name,display_phone_number,quality_rating,platform_type,throughput&access_token=${encodeURIComponent(accessToken.trim())}`;
    const res = await fetch(url);
    const data = await res.json();

    if (res.ok && data.id) {
      return {
        success: true,
        httpStatus: res.status,
        data,
        urduAdvice: `✅ میٹا کنکشن کامیاب! رجسٹرڈ نام: ${data.verified_name || data.display_phone_number || 'Business Account'} (کووالٹی: ${data.quality_rating || 'GREEN'})`,
      };
    }

    const parsed = parseMetaError(data, res.status);
    return {
      success: false,
      httpStatus: res.status,
      data,
      errorMessage: parsed.message,
      urduAdvice: parsed.urduAdvice,
    };
  } catch (err: any) {
    return {
      success: false,
      errorMessage: err?.message || 'Network error',
      urduAdvice: 'نیٹ ورک کنکشن چیک کریں۔ میٹا گراف سرورز تک رسائی نہیں ہو سکی۔',
    };
  }
}

export async function sendMetaWhatsAppMessage({
  phoneNumberId,
  accessToken,
  recipientPhone,
  messageText,
  messageType = 'auto',
  templateName = 'hello_world',
  templateLanguage = 'en_US',
}: {
  phoneNumberId: string;
  accessToken: string;
  recipientPhone: string;
  messageText?: string;
  messageType?: 'text' | 'template' | 'auto';
  templateName?: string;
  templateLanguage?: string;
}): Promise<MetaSendResult> {
  const formattedPhone = formatPhoneForMeta(recipientPhone);
  const nowIso = new Date().toLocaleString('ur-PK');

  if (!phoneNumberId || !accessToken) {
    return {
      success: false,
      httpStatus: 400,
      errorMessage: 'Phone Number ID and Access Token are required',
      urduAdvice: 'سیٹنگز میں Phone Number ID اور Access Token درج کریں۔',
      timestamp: nowIso,
    };
  }

  const url = `https://graph.facebook.com/v20.0/${phoneNumberId.trim()}/messages`;
  const headers = {
    'Authorization': `Bearer ${accessToken.trim()}`,
    'Content-Type': 'application/json',
  };

  // Helper for text send
  const sendText = async (): Promise<MetaSendResult> => {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedPhone,
      type: 'text',
      text: { preview_url: false, body: messageText || 'السلام علیکم' },
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.messages && data.messages[0]?.id) {
        return {
          success: true,
          httpStatus: res.status,
          messageId: data.messages[0].id,
          rawResponse: data,
          sentPayload: payload,
          recipientPhoneFormatted: formattedPhone,
          timestamp: nowIso,
          urduAdvice: `✅ میسج کامیابی سے بھیج دیا گیا! Message ID: ${data.messages[0].id}`,
        };
      }
      const parsed = parseMetaError(data, res.status);
      return {
        success: false,
        httpStatus: res.status,
        errorCode: parsed.code,
        errorMessage: parsed.message,
        urduAdvice: parsed.urduAdvice,
        rawResponse: data,
        sentPayload: payload,
        recipientPhoneFormatted: formattedPhone,
        timestamp: nowIso,
      };
    } catch (err: any) {
      return {
        success: false,
        httpStatus: 500,
        errorMessage: err?.message || 'Network error',
        urduAdvice: 'نیٹ ورک ایرر: میٹا سرور تک رسائی میں ناکامی۔',
        sentPayload: payload,
        recipientPhoneFormatted: formattedPhone,
        timestamp: nowIso,
      };
    }
  };

  // Helper for template send
  const sendTemplate = async (): Promise<MetaSendResult> => {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedPhone,
      type: 'template',
      template: {
        name: (templateName || 'hello_world').trim(),
        language: { code: (templateLanguage || 'en_US').trim() },
      },
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.messages && data.messages[0]?.id) {
        return {
          success: true,
          httpStatus: res.status,
          messageId: data.messages[0].id,
          rawResponse: data,
          sentPayload: payload,
          recipientPhoneFormatted: formattedPhone,
          timestamp: nowIso,
          urduAdvice: `✅ (Template Mode) میسج کامیابی سے بھیج دیا گیا! ID: ${data.messages[0].id}`,
        };
      }
      const parsed = parseMetaError(data, res.status);
      return {
        success: false,
        httpStatus: res.status,
        errorCode: parsed.code,
        errorMessage: parsed.message,
        urduAdvice: parsed.urduAdvice,
        rawResponse: data,
        sentPayload: payload,
        recipientPhoneFormatted: formattedPhone,
        timestamp: nowIso,
      };
    } catch (err: any) {
      return {
        success: false,
        httpStatus: 500,
        errorMessage: err?.message || 'Network error',
        urduAdvice: 'نیٹ ورک ایرر: میٹا سرور تک رسائی میں ناکامی۔',
        sentPayload: payload,
        recipientPhoneFormatted: formattedPhone,
        timestamp: nowIso,
      };
    }
  };

  if (messageType === 'template') {
    return await sendTemplate();
  }

  if (messageType === 'text') {
    return await sendText();
  }

  // Auto Mode: try text first, fallback to template if 24h window
  const textResult = await sendText();
  if (textResult.success) return textResult;

  if (textResult.errorCode === 131047 || textResult.errorCode === 132001) {
    const templateResult = await sendTemplate();
    if (templateResult.success) {
      templateResult.urduAdvice = `⚠️ (24h Window restriction) فری متن میسج بلاک ہوا تھا، اس لیے میٹا Approved Template (${templateName || 'hello_world'}) کے ذریعے کامیابی سے ارسال کر دیا گیا! ID: ${templateResult.messageId}`;
      return templateResult;
    }
    return {
      ...templateResult,
      urduAdvice: `${textResult.urduAdvice}\n\n[ٹیمپلیٹ ناکامی]: ${templateResult.urduAdvice || ''}`,
    };
  }

  return textResult;
}
