<script setup lang="ts">
import type { PolicySection } from '~/components/PolicyDocument.vue'

useHead({ title: 'Privacy policy | GPTpatient' })

const vietnamese: PolicySection[] = [
  {
    heading: 'Về GPTpatient và phạm vi dịch vụ',
    paragraphs: ['GPTpatient là ứng dụng giáo dục giúp người học luyện giao tiếp lâm sàng trong các tình huống bệnh nhân giả lập, tập trung vào thăm khám sản phụ khoa. Dịch vụ không cung cấp chẩn đoán, điều trị, tư vấn y tế hoặc hồ sơ bệnh án. Chỉ sử dụng thông tin hư cấu; không nhập tên, hồ sơ, dữ liệu sức khỏe hoặc chi tiết có thể nhận dạng bệnh nhân thật.'],
    bullets: ['Người dùng phải từ đủ 18 tuổi.', 'Đăng nhập không tự cấp quyền sử dụng: GPTpatient kiểm tra tư cách thành viên, vai trò và quyền của workspace.']
  },
  {
    heading: 'Dữ liệu tài khoản Google',
    paragraphs: ['Khi bạn chọn đăng nhập Google, Google cung cấp mã định danh tài khoản ổn định, địa chỉ email và có thể cung cấp các trường hồ sơ cơ bản. GPTpatient dùng mã định danh để xác thực và đối chiếu thành viên workspace; email được dùng để hiển thị tài khoản và hỗ trợ đăng nhập. Supabase Auth do đơn vị vận hành GPTpatient tự lưu trữ xử lý quy trình OAuth và phiên đăng nhập. GPTpatient không truy cập Gmail, Drive, Lịch hoặc danh bạ.'],
    bullets: ['Dữ liệu tài khoản Google chỉ được dùng cho đăng nhập, phiên tài khoản, hiển thị tài khoản và kiểm tra quyền workspace.', 'GPTpatient không bán dữ liệu Google, không dùng dữ liệu này cho quảng cáo, và không gửi dữ liệu tài khoản Google đến OpenAI để tạo hoặc huấn luyện mô hình AI.']
  },
  {
    heading: 'Dữ liệu luyện tập và giọng nói',
    paragraphs: ['Để vận hành buổi luyện tập, GPTpatient xử lý nội dung bạn gửi, nội dung phản hồi bệnh nhân giả lập, giai đoạn buổi học, sự kiện và số liệu sử dụng. Nội dung buổi học và lịch sử tương tác được lưu trong PostgreSQL; Redis giữ trạng thái hoạt động tạm thời để tiếp tục phiên. Nội dung được dùng để cung cấp, khôi phục, bảo vệ và kiểm tra quyền của tính năng bạn yêu cầu.'],
    bullets: ['Nếu quản trị viên workspace bật tính năng giọng nói và bạn chấp thuận trước buổi học, âm thanh microphone được truyền đến OpenAI để phiên âm theo thời gian thực. GPTpatient không lưu âm thanh thô; câu nói đã được chấp nhận sẽ được lưu như nội dung hội thoại của buổi học.', 'Trong buổi học đang hoạt động, GPTpatient có thể ghi nhận xung thời gian 30 giây khi trang đang hiển thị và có tương tác gần đây. Xung không chứa nội dung thao tác; thời lượng là ước tính để quản trị viên workspace xem báo cáo, không phải giám sát liên tục hoặc bằng chứng CEU.', 'OpenAI xử lý nội dung cần thiết để tạo phản hồi bệnh nhân giả lập hoặc phiên âm khi bạn bật tính năng tương ứng. Nội dung hư cấu của buổi học không bao gồm dữ liệu tài khoản Google.']
  },
  {
    heading: 'Nhà cung cấp, chia sẻ và bảo vệ dữ liệu',
    paragraphs: ['Google xử lý dữ liệu tài khoản trong quy trình đăng nhập. OpenAI xử lý nội dung cần thiết cho phản hồi AI và phiên âm khi tính năng được sử dụng. PostgreSQL và Redis lưu dữ liệu ứng dụng trên hạ tầng do đơn vị vận hành GPTpatient quản lý. Dịch vụ lưu trữ và hạ tầng có thể xử lý địa chỉ IP, loại trình duyệt, thời điểm, đường dẫn và mã trạng thái trong nhật ký bảo mật và vận hành. Cấu hình hạ tầng quyết định địa điểm xử lý; chính sách này không khẳng định dữ liệu luôn ở một quốc gia cụ thể.'],
    bullets: ['Không bán dữ liệu cá nhân hoặc chia sẻ dữ liệu Google để quảng cáo, tiếp thị hành vi hay môi giới dữ liệu.', 'GPTpatient sử dụng HTTPS/TLS cho kết nối web và kiểm tra xác thực, workspace, vai trò và quyền ở phía máy chủ. Không có hệ thống nào có thể bảo đảm an toàn tuyệt đối.']
  },
  {
    heading: 'Lưu giữ, yêu cầu của bạn và cập nhật',
    paragraphs: ['Cookie phiên đăng nhập được lưu trong trình duyệt để duy trì phiên và hết hạn theo cấu hình xác thực. Trạng thái phiên đang hoạt động trong Redis là dữ liệu tạm thời. Dữ liệu tài khoản, thành viên và lịch sử buổi học trong PostgreSQL hiện không có chức năng tự xóa theo lịch cố định hoặc nút tự xóa tài khoản; dữ liệu này được giữ đến khi đơn vị vận hành xóa theo yêu cầu đã xác minh hoặc theo nghĩa vụ lưu giữ hợp pháp. Nhật ký máy chủ và bản sao lưu có thể tồn tại đến khi quy trình luân chuyển tương ứng xóa chúng.'],
    bullets: ['Bạn có thể yêu cầu truy cập, sửa hoặc xóa dữ liệu tài khoản bằng cách gửi email đến admin@eagles.edu.vn. Yêu cầu được xác minh trước khi xử lý; dữ liệu có thể được giữ khi pháp luật yêu cầu.', 'Chính sách này được cập nhật ngày 14 tháng 10 năm 2026. Khi cách xử lý dữ liệu Google thay đổi, GPTpatient sẽ cập nhật chính sách và thông báo phù hợp trước khi thay đổi có hiệu lực.']
  }
]

const english: PolicySection[] = [
  {
    heading: 'About GPTpatient and the service',
    paragraphs: ['GPTpatient is an educational application for practicing clinical communication through fictional standardized-patient scenarios, with a focus on obstetrics and gynecology history-taking. It does not provide diagnosis, treatment, medical advice, or medical records. Use fictional information only; do not enter names, records, health information, or details that could identify a real patient.'],
    bullets: ['Users must be at least 18 years old.', 'Signing in does not itself grant practice access. GPTpatient checks workspace membership, role, and entitlements.']
  },
  {
    heading: 'Google account data',
    paragraphs: ['When you choose Google sign-in, Google returns a stable account identifier, your email address, and may return basic profile fields. GPTpatient uses the identifier to authenticate you and match workspace membership; your email is used to display your account and support sign-in. GPTpatient operator-managed Supabase Auth processes the OAuth flow and account session. GPTpatient does not access Gmail, Drive, Calendar, or Contacts.'],
    bullets: ['Google account data is used only for sign-in, account sessions and display, and workspace access checks.', 'GPTpatient does not sell Google data, use it for advertising, or send Google account data to OpenAI for AI generation or model training.']
  },
  {
    heading: 'Practice and voice data',
    paragraphs: ['To provide a practice session, GPTpatient processes your submitted content, fictional patient responses, session phase, events, and usage measurements. Session content and interaction history are stored in PostgreSQL; Redis holds temporary active-session state for continuity. This data is used to provide, resume, secure, and check access to the features you request.'],
    bullets: ['If a workspace administrator enables voice and you accept the session consent, microphone audio is streamed to OpenAI for real-time transcription. GPTpatient does not store raw microphone audio; accepted speech is stored as session conversation content.', 'During an active practice session, GPTpatient may record a 30-second activity pulse when the page is visible and there has been recent interaction. Pulses contain no interaction content. The resulting duration is an estimate shown in workspace-admin reports, not continuous monitoring or CEU evidence.', 'OpenAI processes the content needed to generate fictional patient responses or transcribe speech when you use those features. Fictional session content does not include Google account data.']
  },
  {
    heading: 'Providers, sharing, and security',
    paragraphs: ['Google processes account data for sign-in. OpenAI processes the content needed for AI responses and transcription when those features are used. PostgreSQL and Redis store application data on infrastructure managed by the GPTpatient operator. Hosting and infrastructure services may process IP address, browser type, timestamps, request paths, and status codes in security and operations logs. Deployment configuration determines processing locations; this policy does not claim that data always remains in one country.'],
    bullets: ['GPTpatient does not sell personal data or share Google data for advertising, behavioral marketing, or data brokerage.', 'GPTpatient uses HTTPS/TLS for web connections and server-side authentication, workspace, role, and entitlement checks. No system can guarantee absolute security.']
  },
  {
    heading: 'Retention, your requests, and policy updates',
    paragraphs: ['Sign-in session cookies are stored in your browser to maintain your session and expire according to authentication settings. Active Redis session state is temporary. Account, membership, and session-history records in PostgreSQL do not currently have a fixed automatic deletion schedule or a self-service account deletion control; they are retained until the GPTpatient operator deletes them after a verified request or as required by law. Server logs and backups may remain until their respective rotation processes remove them.'],
    bullets: ['You may request access to, correction of, or deletion of account data by emailing admin@eagles.edu.vn. Requests are verified before processing; information may be retained where required by law.', 'This policy was last updated October 14, 2026. GPTpatient will update this policy and provide appropriate notice before changing how Google data is handled.']
  }
]
</script>

<template>
  <PolicyDocument
    title="Privacy policy"
    subtitle="Chính sách bảo vệ dữ liệu cá nhân"
    :vietnamese="vietnamese"
    :english="english"
  />
</template>
