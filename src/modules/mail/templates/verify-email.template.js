export const verifyEmailTemplate = ({ name, otp, verificationUrl }) => {
  const greeting = name ? `<p>Hello ${name},</p>` : '';
  const actionButton = verificationUrl
    ? `<div style="text-align: center; margin: 24px 0;">
        <a href="${verificationUrl}" style="background-color: #111; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Verify Email Address</a>
       </div>`
    : '';

  return {
    subject: 'Verify your Murafiq account',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        ${greeting}
        <p>Thank you for registering with Murafiq. Please verify your email address to complete your account setup.</p>
        <div style="background-color: #f4f4f4; border-radius: 8px; padding: 16px; text-align: center; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #111;">${otp}</span>
        </div>
        ${actionButton}
        <p style="color: #666; font-size: 14px;">This code will expire in 10 minutes. If you did not create a Murafiq account, you can safely ignore this email.</p>
        <br />
        <p>Best regards,<br />The Murafiq Team</p>
      </div>
    `,
  };
};

export default verifyEmailTemplate;
