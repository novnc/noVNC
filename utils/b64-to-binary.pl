#!/usr/bin/env perl
use MIME::Base64;

for (<>) {
    unless (/^'([{}])(\d+)\1(.+?)',$/) {
        print;
        next;
    }

    my ($dir, $amt, $b64) = ($1, $2, $3);

    my $decoded = MIME::Base64::decode($b64) or die "Could not base64-decode line `$_`";

    my $decoded_escaped = join "", map { "\\x$_" } unpack("(H2)*", $decoded);

    print "'${dir}${amt}${dir}${decoded_escaped}',\n";
}
