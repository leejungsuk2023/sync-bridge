export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-8">Privacy Policy — SyncBridge</h1>
        <p className="text-sm text-slate-500 mb-8">Last updated: February 24, 2026</p>

        <section className="space-y-6 text-slate-700 leading-relaxed">
          <div>
            <h2 className="text-lg font-semibold mb-2">1. Overview</h2>
            <p>
              SyncBridge is a BPO (Business Process Outsourcing) work management platform
              that connects Korean businesses with Thai remote workers.
              This privacy policy explains how we collect, use, and protect your data.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">2. Data We Collect</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Account information:</strong> Email address and display name for authentication.</li>
              <li><strong>Work data:</strong> Task assignments, chat messages, and work status logs.</li>
              <li><strong>Activity data:</strong> Online/offline status and time logs for attendance tracking.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">3. How We Use Your Data</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>To provide real-time task management and communication between managers and workers.</li>
              <li>To translate messages between Korean and Thai using Google Gemini API.</li>
              <li>To provide AI-assisted reply suggestions for customer service.</li>
              <li>To generate attendance and work performance reports.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">4. Third-Party Services</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Supabase:</strong> Database, authentication, and real-time synchronization.</li>
              <li><strong>Google Gemini API:</strong> Translation and AI text analysis (message content is sent for processing).</li>
              <li><strong>Vercel:</strong> Web application hosting.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">5. Data Security</h2>
            <p>
              All data is transmitted over HTTPS. Database access is protected by
              Row Level Security (RLS) policies ensuring users can only access their authorized data.
              Service role keys are used only on the server side and never exposed to clients.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">6. Data Retention</h2>
            <p>
              Your data is retained as long as your account is active.
              Account deletion can be requested through your organization administrator.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">7. Contact</h2>
            <p>
              For privacy-related inquiries, please contact us at:{' '}
              <a href="mailto:goldfender01@gmail.com" className="text-emerald-600 underline">
                goldfender01@gmail.com
              </a>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
