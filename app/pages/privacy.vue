<script setup lang="ts">
import type { PolicySection } from '~/components/PolicyDocument.vue'

useHead({ title: 'Privacy policy | GPTpatient' })

const vietnamese: PolicySection[] = [
  {
    heading: 'Dữ liệu và mục đích sử dụng',
    paragraphs: ['Tùy tính năng bạn sử dụng, ứng dụng có thể xử lý email và mã định danh tài khoản do nhà cung cấp đăng nhập Google trả về; thông tin thành viên workspace; dữ liệu sử dụng và nhật ký kỹ thuật; cùng nội dung bạn gửi trong tình huống luyện tập giả lập. Dữ liệu này được dùng để đăng nhập, kiểm tra quyền truy cập, vận hành, bảo vệ và khắc phục sự cố dịch vụ.'],
    bullets: ['Không nhập tên, hồ sơ, dữ liệu sức khỏe hoặc thông tin có thể nhận dạng bệnh nhân thật.', 'Không lưu thông tin thanh toán thẻ trong ứng dụng hiện tại; chưa có giao dịch thanh toán trực tiếp.']
  },
  {
    heading: 'Nhà cung cấp dịch vụ và chuyển dữ liệu',
    paragraphs: ['Đăng nhập sử dụng dịch vụ Supabase Auth tự lưu trữ cho quy trình OAuth với Google. Những tính năng máy chủ có sử dụng mô hình OpenAI có thể gửi nội dung cần thiết của yêu cầu đến OpenAI để tạo phản hồi. Hệ thống API cũng sử dụng PostgreSQL và Redis cho dữ liệu ứng dụng. Cấu hình triển khai quyết định nơi các dịch vụ này được vận hành; không khẳng định dữ liệu luôn ở một quốc gia cụ thể. Thông tin nhà cung cấp và chuyển dữ liệu phải được rà soát trước khi mở dịch vụ công khai.']
  },
  {
    heading: 'Lưu giữ, quyền của bạn và bảo vệ dữ liệu',
    paragraphs: ['Thời hạn lưu giữ phụ thuộc loại dữ liệu và cấu hình dịch vụ; hiện chưa công bố một lịch xóa thống nhất. Bạn có thể yêu cầu truy cập, sửa hoặc xóa dữ liệu tài khoản bằng cách liên hệ hỗ trợ. Yêu cầu sẽ được xác minh và xử lý theo quy định áp dụng và nghĩa vụ lưu giữ hợp pháp. Ứng dụng không lưu dữ liệu tài khoản hoặc encounter trong local storage của trình duyệt. Cookie phiên đăng nhập có thể được dùng khi Supabase Auth được cấu hình.']
  },
  {
    heading: 'Cập nhật chính sách',
    paragraphs: ['Chính sách này cần được cập nhật khi nhà cung cấp, dữ liệu được xử lý, thời hạn lưu giữ hoặc tính năng thanh toán thay đổi. Ngày cập nhật và thông tin đơn vị chịu trách nhiệm cần được công bố trước khi mở bán dịch vụ.']
  }
]

const english: PolicySection[] = [
  {
    heading: 'Data and purposes',
    paragraphs: ['Depending on the features you use, the application may process your email and account identifier returned by Google sign-in; workspace membership; usage and technical logs; and content you submit in fictional practice scenarios. This data supports sign-in, access checks, service operation, protection, and troubleshooting.'],
    bullets: ['Do not enter names, records, health information, or details that identify a real patient.', 'The current application does not store card details and does not take direct payments.']
  },
  {
    heading: 'Service providers and transfers',
    paragraphs: ['Sign-in uses a self-hosted Supabase Auth service for Google OAuth. Server features that use an OpenAI model may send the content needed for a request to OpenAI to generate a response. The API also uses PostgreSQL and Redis for application data. Deployment configuration determines where these services operate; this policy does not claim that data always remains in one country. Provider and transfer details must be reviewed before public launch.']
  },
  {
    heading: 'Retention, your requests, and data protection',
    paragraphs: ['Retention depends on the data type and service configuration; a single deletion schedule has not yet been published. You may request access to, correction of, or deletion of account data by contacting support. Requests will be verified and handled under applicable law and lawful retention duties. The application does not save account or encounter data in browser local storage. Sign-in session cookies may be used when Supabase Auth is configured.']
  },
  {
    heading: 'Policy updates',
    paragraphs: ['This policy must be updated when service providers, processed data, retention periods, or payment features change. The effective date and responsible service operator details must be published before paid service begins.']
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
