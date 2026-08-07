**Konnet Platform Credits Recharge Flow** (Dedicated Virtual Account)

**Objective**

Provide a simple, trusted, and frictionless way for users to purchase platform credits without leaving the familiar banking channels they already use.

Every konnet user is automatically assigned a permanent Dedicated Virtual Account during registration. This account is used exclusively for funding their konnet wallet.

**Business Principle**

One User → One konnet Account → One Permanent Virtual Account → One Credit Wallet

Users never need to request payment details or generate payment links.

Whenever they want to recharge, the same account details are displayed.

**Vendor Onboarding**

The first time a user interacts with konnet on WhatsApp:

1\. System creates a user account.  
2\. System creates a credit wallet.  
3\. System requests a Dedicated Virtual Account from Paystack.  
4\. Paystack assigns a unique bank account to the user.  
5\. System permanently links that Virtual Account to the user's wallet.

This happens only once.

**Recharge User Experience**

Whenever a user needs credits:

User:  “Recharge”

konnet responds with:

Current Balance

18 Credits

━━━━━━━━━━━━━━━━━━

Transfer money to your konnet Funding Account

Bank:  
Paystack Bank

Account Number:  
8134567892

Account Name:  
konnet \- Collins

━━━━━━━━━━━━━━━━━━

Your credits will be added automatically  
once payment is received.

**User Experience Benefits** 

No payment links.

No checkout page.

No QR codes.

No manual payment confirmation.

The user simply transfers money.

**Behind The Scenes**

Step 1

The user transfers money exactly the same way they normally send money.

Step 2

Money arrives in the user's Dedicated Virtual Account.

Step 3

Paystack immediately notifies konnet through a secure webhook that Payment was Received

Step 4

konnet identifies the owner via account info:

Account Number

    ↓

Wallet

    ↓

User

    ↓

Credit Package

Since every account number belongs to only one user, no payment references are required.

Step 5

konnet converts the payment into platform credits.

Example:

₦5,000

     ↓

50 Credits

Step 6

The user's wallet is updated instantly.

Wallet

Before:  
18 Credits

After:  
68 Credits

Step 7

konnet immediately sends a WhatsApp confirmation.

✅ Payment Received

₦5,000 has been received.

50 Credits have been added.

Current Balance:

68 Credits

Super easy, No manual verification is required.

**End-to-End Flow**

User  
    │  
   ▼  
Requests Recharge  
    │  
   ▼  
konnet displays permanent  
Virtual Account  
    │  
   ▼  
User transfers money  
using any banking channel  
    │  
   ▼  
Money reaches  
Dedicated Virtual Account  
    │  
   ▼  
Paystack sends webhook  
to konnet  
    │  
   ▼  
konnet identifies user  
    │  
   ▼  
Wallet credited  
    │  
   ▼  
WhatsApp confirmation sent to user 

**Business Benefits**

**1\. Familiar Experience**

Users pay exactly as they already do every day.

No learning curve.

**2\. No Checkout Pages**

Users do not interact with external payment pages.

The conversation remains the primary interface.

**3\. No Payment Links**

No links need to be generated.

The same Virtual Account is reused forever.

**4\. Automatic Reconciliation**

Each Virtual Account belongs to only one user.

Every payment can be matched automatically.

**5\. Faster Repeat Payments**

Returning users already know their funding account.

Recharging becomes almost effortless.

**6\. Highly Scalable**

The process remains identical whether konnet has:

\* 100 users  
\* 10,000 users  
\* 1 million users

No additional operational complexity is introduced.

**Feature Summary**

The Dedicated Virtual Account model makes funding a konnet wallet feel as natural as making a normal bank transfer. Users always recharge using the same personal account details, while konnet automatically detects incoming payments, converts them into platform credits, updates the user's wallet, and confirms the transaction within WhatsApp. This keeps the entire experience simple, trustworthy, and scalable while minimizing payment friction.  
