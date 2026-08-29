export const otpTemplate = ({ name, otp }) => {
  const greeting = name ? `<p>Hello ${name},</p>` : '';
  return {
    subject: 'Your Murafiq verification code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        ${greeting}
        <p>Your Murafiq verification code is:</p>
        <div style="background-color: #f4f4f4; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #111;">${otp}</span>
        </div>
        <p style="color: #666; font-size: 14px;">This code will expire in 10 minutes. If you did not request this code, please ignore this email.</p>
        <br />
        <p>Best regards,<br />The Murafiq Team</p>
      </div>
    `,
  };
};

export default otpTemplate;
