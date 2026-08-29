export const bookingConfirmationTemplate = ({
  clientName,
  stylistName,
  scheduledDate,
  startTime,
  location,
  price,
}) => {
  const locationText = location ? `<p style="margin: 4px 0;"><strong>Location:</strong> ${location}</p>` : '';
  return {
    subject: 'Booking Confirmation — Murafiq',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <h2>Your Shopping Session is Confirmed!</h2>
        <p>Hello ${clientName || 'there'},</p>
        <p>Your session with <strong>${stylistName}</strong> has been successfully booked and confirmed.</p>
        <div style="background-color: #f8f9fa; border-left: 4px solid #111; padding: 16px; margin: 20px 0;">
          <p style="margin: 4px 0;"><strong>Date:</strong> ${scheduledDate}</p>
          <p style="margin: 4px 0;"><strong>Time:</strong> ${startTime}</p>
          ${locationText}
          <p style="margin: 4px 0;"><strong>Total Price:</strong> ${price} EGP</p>
        </div>
        <p>You can chat directly with your stylist in the Murafiq app to finalize details before your session.</p>
        <br />
        <p>Best regards,<br />The Murafiq Team</p>
      </div>
    `,
  };
};

export default bookingConfirmationTemplate;
