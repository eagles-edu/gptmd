<script setup lang="ts">
import type { PolicySection } from '~/components/PolicyDocument.vue'

useHead({ title: 'Terms of service | GPTpatient' })

const vietnamese: PolicySection[] = [
  {
    heading: 'Độ tuổi',
    paragraphs: ['Bạn phải từ đủ 18 tuổi trở lên để sử dụng dịch vụ. Dịch vụ chưa được thiết kế cho tài khoản do trẻ vị thành niên tự đăng ký.']
  },
  {
    heading: 'Phạm vi dịch vụ',
    paragraphs: ['GPTpatient hỗ trợ luyện tập giao tiếp lâm sàng với các tình huống giả lập dành cho mục đích giáo dục. Ứng dụng không cung cấp chẩn đoán, điều trị, tư vấn y tế hoặc hồ sơ bệnh án; không thay thế hướng dẫn của giảng viên hay chuyên gia y tế. Không đưa dữ liệu bệnh nhân thật vào dịch vụ.']
  },
  {
    heading: 'Tài khoản và sử dụng được phép',
    paragraphs: ['Bạn cần sử dụng tài khoản của mình, giữ an toàn thông tin đăng nhập và thông báo khi nghi ngờ truy cập trái phép. Bạn chịu trách nhiệm về việc sử dụng tài khoản trong phạm vi pháp luật cho phép. Không được lạm dụng dịch vụ, cố truy cập trái phép, gây gián đoạn hoặc gửi dữ liệu mà bạn không có quyền cung cấp.']
  },
  {
    heading: 'Nội dung, quyền và giới hạn',
    paragraphs: ['Quyền đối với nội dung và tài sản trí tuệ thuộc về chủ thể tương ứng theo pháp luật; điều khoản này không tuyên bố GPTpatient sở hữu mọi giao diện, mã nguồn, logo hoặc nội dung. Dịch vụ có thể tạm gián đoạn để bảo trì hoặc xử lý sự cố. Không điều khoản nào loại trừ quyền khiếu nại, yêu cầu bồi thường hoặc quyền bắt buộc của người tiêu dùng theo pháp luật.']
  },
  {
    heading: 'Giao dịch và hủy quyền truy cập',
    paragraphs: ['Hiện chưa có giao dịch trả phí hoặc gia hạn định kỳ. Bạn có thể yêu cầu chấm dứt quyền truy cập workspace qua trang Contact. Nếu checkout được triển khai, giá áp dụng, thời hạn truy cập, giới hạn giao dịch, quy trình hủy và điều kiện hoàn tiền sẽ được hiển thị trước khi bạn đặt dịch vụ.']
  },
  {
    heading: 'Luật áp dụng và tranh chấp',
    paragraphs: ['Điều khoản này được điều chỉnh theo pháp luật Việt Nam, đồng thời tôn trọng các quy định bắt buộc về bảo vệ người tiêu dùng áp dụng cho bạn. Bạn có thể liên hệ GPTpatient để đề nghị giải quyết và vẫn giữ quyền gửi tranh chấp đến cơ quan hoặc tòa án có thẩm quyền.']
  },
  {
    heading: 'Liên hệ và thay đổi',
    paragraphs: ['Nếu cần trợ giúp hoặc muốn khiếu nại, hãy dùng trang Contact và mô tả vấn đề mà không gửi dữ liệu bệnh nhân thật. Điều khoản áp dụng cho giao dịch trả phí (nếu có) sẽ được cung cấp để bạn xem trước khi giao dịch.']
  }
]

const english: PolicySection[] = [
  {
    heading: 'Age requirement',
    paragraphs: ['You must be at least 18 years old to use the service. The service is not designed for accounts independently registered by minors.']
  },
  {
    heading: 'Service scope',
    paragraphs: ['GPTpatient supports educational practice in clinical communication using fictional scenarios. It does not provide diagnosis, treatment, medical advice, or medical records and does not replace instruction from educators or healthcare professionals. Do not submit real patient data.']
  },
  {
    heading: 'Accounts and acceptable use',
    paragraphs: ['Use your own account, protect your sign-in details, and report suspected unauthorized access. You are responsible for account use to the extent permitted by law. Do not misuse the service, attempt unauthorized access, disrupt its operation, or submit data you have no right to provide.']
  },
  {
    heading: 'Content, rights, and limitations',
    paragraphs: ['Rights in content and intellectual property belong to their respective owners under applicable law; these terms do not claim GPTpatient owns every interface, source file, logo, or item of content. The service may be interrupted for maintenance or incident response. Nothing here excludes a consumer right to complain, seek compensation, or exercise another right that cannot lawfully be excluded.']
  },
  {
    heading: 'Transactions and cancellation',
    paragraphs: ['No paid transaction or recurring billing is currently available. You may request removal of workspace access through the Contact page. If checkout is introduced, applicable prices, access period, transaction limits, cancellation process, and refund terms will be shown before you place an order.']
  },
  {
    heading: 'Governing law and disputes',
    paragraphs: ['These terms are governed by the laws of Viet Nam, subject to mandatory consumer protections that apply to you. You may contact GPTpatient to seek resolution and retain any right to refer a dispute to a competent authority or court.']
  },
  {
    heading: 'Contact and changes',
    paragraphs: ['For help or to submit a complaint, use the Contact page and do not include real patient data. Terms applying to a paid transaction, if introduced, will be provided for review before that transaction.']
  }
]
</script>

<template>
  <PolicyDocument
    title="Terms of service"
    subtitle="Điều khoản sử dụng dịch vụ"
    :vietnamese="vietnamese"
    :english="english"
  />
</template>
