export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Privacy Policy — SyncBridge</h1>
        <p className="text-sm text-slate-500 mb-1">Operated by BBG Co., Ltd.</p>
        <p className="text-sm text-slate-500 mb-10">Last updated: March 11, 2026</p>

        {/* English Section */}
        <section className="space-y-6 text-slate-700 leading-relaxed mb-16">
          <div>
            <h2 className="text-lg font-semibold mb-2">1. Overview</h2>
            <p>
              SyncBridge is a work synchronization platform operated by BBG (a Korean company) that
              connects Korean hospital clients with Thai remote workers. As part of our customer
              service (CS) operations, we integrate with Facebook Messenger and LINE to manage
              inbound customer inquiries. This policy explains how we collect, use, store, and
              protect personal data obtained through these channels.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">2. Data We Collect</h2>
            <p className="mb-2">
              When customers contact hospital clients through Facebook Messenger or LINE, we may
              collect the following data on behalf of the hospital operator:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Customer name</strong> — as provided by the messaging platform profile.</li>
              <li><strong>Profile photo</strong> — as provided by the messaging platform profile.</li>
              <li><strong>Message content</strong> — text messages exchanged during the customer service conversation.</li>
              <li><strong>Platform user ID</strong> — the unique identifier assigned by Facebook or LINE.</li>
              <li><strong>Timestamp</strong> — date and time of each message.</li>
            </ul>
            <p className="mt-2">
              We do not collect sensitive personal data such as national ID numbers, financial
              information, or health records through these messaging channels unless explicitly
              provided by the customer in the course of a consultation inquiry.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">3. How We Use Your Data</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li>To route and display customer inquiries to the assigned customer service worker.</li>
              <li>To provide AI-assisted reply suggestions using Google Gemini API (message content is processed by the API).</li>
              <li>To translate messages between Korean and Thai to facilitate communication.</li>
              <li>To generate customer service performance reports for hospital operators.</li>
            </ul>
            <p className="mt-2">
              Data collected through Facebook Messenger and LINE is used exclusively for customer
              service purposes. We do not sell, rent, or share this data with third parties for
              marketing or advertising.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">4. Data Storage</h2>
            <p>
              All data is stored in Supabase, a cloud database service hosted on AWS infrastructure.
              Data is transmitted over HTTPS and protected by Row Level Security (RLS) policies,
              ensuring each operator can only access their own customer data. Server-side API keys
              are never exposed to end-user clients.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">5. Third-Party Services</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Supabase:</strong> Cloud database and real-time synchronization.</li>
              <li><strong>Google Gemini API:</strong> AI translation and reply suggestion (message content is sent for processing).</li>
              <li><strong>Vercel:</strong> Web application hosting.</li>
              <li><strong>Meta (Facebook Messenger):</strong> Messaging platform integration.</li>
              <li><strong>LINE Corporation (LINE):</strong> Messaging platform integration.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">6. Data Retention</h2>
            <p>
              Customer conversation data collected via Facebook Messenger and LINE is retained for
              up to 12 months from the date of the last message, after which it is deleted from
              our systems. Operator account data is retained for the duration of the active
              service agreement. Account deletion can be requested by contacting us directly.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">7. Your Rights</h2>
            <p>
              Customers who have interacted with a hospital client through our platform may request
              access to, correction of, or deletion of their personal data by contacting us at the
              email address below. We will respond within 30 days.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold mb-2">8. Contact</h2>
            <p>
              For privacy-related inquiries, please contact BBG at:{' '}
              <a href="mailto:goodnightgoodbody@gmail.com" className="text-emerald-600 underline">
                goodnightgoodbody@gmail.com
              </a>
            </p>
          </div>
        </section>

        <hr className="border-slate-200 mb-16" />

        {/* Korean Section */}
        <section className="space-y-6 text-slate-700 leading-relaxed">
          <h2 className="text-xl font-bold mb-6">개인정보 처리방침 (한국어)</h2>

          <div>
            <h3 className="text-lg font-semibold mb-2">1. 개요</h3>
            <p>
              SyncBridge는 BBG(한국 법인)가 운영하는 업무 동기화 플랫폼으로, 한국 병원 고객사와
              태국 원격 근무자를 연결합니다. 고객 서비스(CS) 운영의 일환으로 Facebook Messenger 및
              LINE을 통해 고객 문의를 수집·처리합니다. 본 방침은 이러한 채널을 통해 수집되는
              개인정보의 처리 방식을 설명합니다.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2">2. 수집하는 개인정보</h3>
            <p className="mb-2">
              고객이 Facebook Messenger 또는 LINE을 통해 병원 고객사에 문의하면, 병원 운영자를
              대신하여 다음 정보를 수집할 수 있습니다:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>고객 이름</strong> — 메시징 플랫폼 프로필 기준</li>
              <li><strong>프로필 사진</strong> — 메시징 플랫폼 프로필 기준</li>
              <li><strong>메시지 내용</strong> — 고객 서비스 대화 중 교환된 텍스트 메시지</li>
              <li><strong>플랫폼 사용자 ID</strong> — Facebook 또는 LINE이 부여한 고유 식별자</li>
              <li><strong>타임스탬프</strong> — 각 메시지의 날짜 및 시간</li>
            </ul>
            <p className="mt-2">
              고객이 상담 문의 과정에서 직접 제공하지 않는 한, 주민등록번호·금융정보·건강기록 등
              민감 개인정보는 수집하지 않습니다.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2">3. 개인정보 이용 목적</h3>
            <ul className="list-disc pl-6 space-y-1">
              <li>고객 문의를 담당 상담원에게 배정·표시</li>
              <li>Google Gemini API를 이용한 AI 답변 추천(메시지 내용이 API로 전송됨)</li>
              <li>한국어·태국어 번역을 통한 원활한 소통 지원</li>
              <li>병원 운영자를 위한 고객 서비스 성과 보고서 생성</li>
            </ul>
            <p className="mt-2">
              Facebook Messenger 및 LINE을 통해 수집된 데이터는 고객 서비스 목적으로만 사용됩니다.
              마케팅·광고 목적으로 제3자에게 판매·임대·공유하지 않습니다.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2">4. 데이터 저장</h3>
            <p>
              모든 데이터는 AWS 인프라 기반의 클라우드 데이터베이스 서비스인 Supabase에 저장됩니다.
              데이터는 HTTPS로 전송되며, 행 수준 보안(RLS) 정책으로 보호되어 각 운영자는
              자신의 고객 데이터에만 접근할 수 있습니다.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2">5. 보유 및 파기</h3>
            <p>
              Facebook Messenger 및 LINE을 통해 수집된 고객 대화 데이터는 마지막 메시지로부터
              12개월까지 보유되며, 이후 자동 삭제됩니다. 운영자 계정 데이터는 서비스 계약 기간
              동안 보유됩니다. 계정 삭제는 아래 이메일로 요청하실 수 있습니다.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2">6. 정보주체의 권리</h3>
            <p>
              플랫폼을 통해 병원 고객사와 대화한 고객은 개인정보 열람·수정·삭제를 요청할 수 있습니다.
              요청은 아래 이메일로 접수하며, 30일 이내에 회신드립니다.
            </p>
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2">7. 문의</h3>
            <p>
              개인정보 관련 문의는 BBG로 연락해 주세요:{' '}
              <a href="mailto:goodnightgoodbody@gmail.com" className="text-emerald-600 underline">
                goodnightgoodbody@gmail.com
              </a>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
