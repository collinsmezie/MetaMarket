The Goal of this document is to outline the updated requirements for the buyer-search-workflow and update the existing business rules for the workflow to work exactly as intended. The workflow removes a lot of the complexity of the original workflow and focuses on the core functionality while also accumulating evidence from user interaction and behavior. 

Updated Customer/Buyer Search Workflow & Business Rules

Vendor capability matching stays the same

Vendors in buyers city OR state are shown to the buyer

A whatsapp message is sent to every matched vendor with the following message:

New Customer Request

A customer in [City] is looking for [Product]

Can you fulfill this request?  
[Yes, I have it]  [No, I don't have it]  [I can get it]  [I can refer someone]  [I don't sell this, not my line of business]"

If a vendor responds with "yes, i have it" or "yes, i can get it", the following happens:

The vendor profile card is sent to the buyer via whatsapp message. Vendor profile consists of the following: 
Business name
City
star ratings
whatsapp number
Brief description of capability
Interactive option to "Message Vendor" CTA (this takes the buyer to a whatsapp DM chat with the vendor, if the vendor is an individual seller, the buyer will message the vendor directly, if the vendor is a business, the buyer will message the business page)

The searched product is added to the vendors inventory

The system learns using existing learning systems to learn about the vendor


If a vendor responds with "no, i don't have it", the following happens:

System messages the vendor "ok, noted" and does not send their profile to the buyer.

The system learns using existing learning systems to learn about the vendor

If a vendor responds with "i can refer someone", the system should ask the vendor if they know someone that sells the product and if they do, the system should ask the vendor for the contact details of the person they are referring

The system learns about the vendor's referral capabilities 

if a vendor responds with "i don't sell this, not my line of business", the system learns about the vendor's business scope

Vendor responses are numbered and vendor can respond by replying with the number corresponding to their response or by sending the response in text. They are also allowed to pick multiple options. Selected numbers are separated by commas or dashes in the response and the order in which they were selected does not matter but selected numbers must be mapped to their corresponding text responses for MCOS/CME to handle each request as intended.


The vendors that are ranked highest by the CME (typically 85% in CME terms and above) in the buyers city or state must be shown to the buyer even as they recieve customer request messages so as to ensure that we are not missing out on any potential sales. 

The system should only use Resolved Product name during the entire workflow i.e. when messaging the vendor about the customer request or when sending the vendor card to the buyer e.g If the user says "I want to buy Billiard Balls" the system should use the resolved product name "Billiard Balls" when messaging the vendor or when sending the vendor card to the buyer. The system should use the resolved product name when saving the product to the vendor's inventory.


The described workflow is also applicable to Service Vendors and the procedure for service vendors follows the exact same logic as the product vendors.

Delay tactics: The workflow should use whatsapp's typing indicator to simulate typing only if the system is actively searching for vendors to match the buyer and not stuck in a loop or error or some sort of glitch. It should rather just let the user know that it is searching for vendors and that it will notify them once it finds the right vendors.

The system will NEVER tell the customer that they did not find any vendors that can fulfill their request. Instead, it should rephrase the message in a way that suggests that vendors are available and that the system will notify them once it finds the right vendors, even if it does not have any vendors that can fulfill their request. The message should be something like "We're on it. We'll notify you as soon as we find the right vendors that can fulfill your request."

Finally the system must learn from every interaction and improve over time. This learning should be done using the existing learning systems and/or newly developed learning systems to ensure that the system gets better at understanding user requests and matching them with the right vendors.






Technical Considerations

The customer search workflow is built to handle the complex task of finding the right vendors for a customer's request while also ensuring that the system learns from every interaction and improves over time. It uses a multi-stage approach to identify the right vendors and present them to the buyer. 

The design must not deviate from existing architecture and must use existing systems where possible. The workflow uses two existing systems: the nlu system to understand the user's request and the cme system to match and rank vendors by capability. 

The MCOS system should handle this workflow gracefully without running into errors, crashing, or losing the context of the conversation.

The speed of this workflow must be optimal and must not be compromised by the need to learn from interactions or the complex systems that support the matching process. This is especially true for the aspect of the workflow that involves messaging vendors and sending them the vendor card. This aspect of the workflow should be as fast as possible to ensure that the buyer receives the vendor card in a timely manner. 

